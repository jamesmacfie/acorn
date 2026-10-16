import { z } from 'zod'
import { CORE_EXCLUSIVE_SLOTS } from '../../chrome/extensionPoints.ts'
import { isPluginKeyClaim, isReservedPluginKeyClaim } from '../../chrome/keybindings.ts'
import { LANGUAGE_IDS } from '../../content/languageIds.ts'
import { PANE_LAYOUTS, regionProblem } from '../../chrome/paneLayouts.ts'
import {
  PLUGIN_SETTINGS_CATEGORIES,
  RAIL_SOURCE_VISIBILITY_MAX,
  SETTINGS_SCOPES,
  SETTINGS_SEARCH_MAX,
  SETTINGS_SECTION_ID_RE,
} from '../../chrome/settingsPages.ts'
import { WEBVIEW_HOST_MAX_COUNT } from '../../content/webview.ts'
import { pluginRoute, webviewHost } from './manifestFields.ts'

// ── Host-owned document surfaces ──────────────────────────────────────────────────────────────────
//
// The host owns the editor and the plugin supplies the document: an identity, a read route, an optional
// write route, and a language id. See docs/editor.md for why the sandbox cannot serve one,
// and for the bar a further host-owned region has to clear.

// LSP-shaped request/response routes: position and text in, standard items out, never "run my code
// inside the editor". See docs/editor.md.
export const documentCompletions = z.object({
  route: pluginRoute.describe('A POST route sent the text and cursor position that answers completion items.'),
  // What re-opens the popup mid-word, beyond the editor's own identifier rule. Punctuation, not a
  // grammar.
  triggerCharacters: z
    .array(z.string().min(1).max(2))
    .max(8)
    .default([])
    .describe('Characters that open the completion list mid-word, such as `.`.'),
})

// One language capability: a route in the declaring plugin's namespace, POSTed position and text.
const documentService = z.object({
  route: pluginRoute.describe(
    'A POST route on your Node half, sent the live text and its `revision`. Echo the revision in the answer.',
  ),
})

export const documentRegion = z.object({
  // From the published vocabulary, so an unknown id is a parse error rather than a document that
  // quietly renders as plain text. LSP's spellings (`LANGUAGE_IDS`).
  languageId: z
    .enum(LANGUAGE_IDS)
    .default('plaintext')
    .describe("The document's language, for highlighting, in LSP's spelling such as `typescript`."),
  // GET -> { text }. The host substitutes `:taskId` and `:projectId` from the pane's scope. No other
  // parameter, because no other one is the host's to know.
  read: pluginRoute.describe(
    'A GET route that answers `{ text }`. The host fills in `:taskId` and `:projectId`, and no other parameter.',
  ),
  // PUT { text }. Absent means read-only, which is a real mode: a generated migration or a rendered
  // template in a highlighted viewer wants exactly that.
  write: pluginRoute
    .optional()
    .describe('A PUT route sent `{ text }` when the person saves. Leave it out for a read-only document.'),
  completions: documentCompletions.optional().describe('Completions while the person types.'),
  // Hover and diagnostics, POSTed the live buffer (`PluginHoverRequest`). A region's own
  // routes are the only ones its document is sent to: a file-language provider never reaches it.
  hover: documentService.optional().describe('Text shown when the person hovers over the document.'),
  diagnostics: documentService.optional().describe('Errors and warnings drawn in the document.'),
})

// Hover and diagnostics for Editor's files, by language rather than by region. Each route is the
// declaring plugin's own. When two plugins serve one language, the person picks on the Node; until
// then neither runs (docs/editor/document-surface.md § Language smarts).
export const documentServiceDescriptor = z
  .object({
    id: z.string().min(1).max(64).describe("The service's ID, unique in this manifest."),
    label: z
      .string()
      .min(1)
      .max(80)
      .describe("The service's name, shown when two plugins serve one language and the person picks."),
    languageId: z
      .enum(LANGUAGE_IDS)
      .describe("The language of the Editor files it serves, in LSP's spelling such as `python`."),
    hover: documentService
      .optional()
      .describe('Text shown when the person hovers in a file. Give `hover`, `diagnostics`, or both.'),
    diagnostics: documentService.optional().describe('Errors and warnings drawn in a file. Read only: no fixes.'),
  })
  .refine((service) => service.hover || service.diagnostics, {
    message: 'a document service needs hover, diagnostics, or both',
  })

// What fills one region of a layout. Three kinds, and the difference between them is who draws the
// pixels.
//
// `'frame'` is this plugin's own bundle in a sandboxed iframe: the plugin draws, and the host sees a
// rectangle. A `remote` region is the same bundle running in a worker with no DOM, emitting a tree of
// the host's own component names, which the host draws (docs/plugins/tree-contract.md § The tree contract); `entry`
// is a key of the object the bundle passed to `mountTree`. A document region is host-drawn outright:
// the plugin contributes routes and a language id, no code.
//
// Two of the three run the plugin's bytes, and both require an accepted bundle hash. The host checks
// them separately (`hasFrameRegion`, `hasRemoteRegion`): one needs an iframe origin, the other a worker
// port. A document region needs neither.
const paneRegionSource = z.union([
  z.literal('frame'),
  z
    .object({
      kind: z.literal('remote').describe("A tree your client bundle draws with the host's components."),
      entry: z.string().min(1).max(64).describe('The `mountTree` entry that draws this region.'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('document').describe("A document the host's editor draws, read and written through your routes."),
    })
    .extend(documentRegion.shape),
])

// Cooperative navigation into a surface another plugin owns. The destination is a notice-target
// kind, not a route: the owning client plugin decides how to present the resource, and the caller
// gains no API access to it. `noticeKind` is also explicit because a loaded node otherwise emits the
// quiet generic plugin kind.
export const navigationDestination = z
  .object({
    id: z.string().min(1).max(64).describe("The destination's ID, which your tree names when it asks to go there."),
    label: z.string().min(1).max(120).describe('What the trust prompt calls the destination.'),
    targetKind: z
      .string()
      .min(1)
      .max(64)
      .describe('The kind of thing it opens, which the plugin that owns that view presents.'),
    noticeKind: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("The notice kind sent with it, when it isn't the plugin default."),
  })
  .strict()

const settingsKeywords = z
  .array(z.string().min(1).max(64))
  .max(SETTINGS_SEARCH_MAX)
  .describe('Words Settings search matches besides the label.')

export const frameSurface = z
  .object({
    // Which registry this lands in. The shell renders them all the same way; the surrounding chrome it
    // supplies is what differs.
    //
    // `overlay` is the full-screen picker slot: the host places the rectangle and the frame draws its
    // contents. It has no click site, so `openOverlay` is the only way to open one. `coreSlot` is drawn
    // where one of core's own surfaces normally is; registering one seizes nothing, because the user
    // picks the provider in settings. See docs/plugins/replacing-core-surfaces.md § Replacing a core surface.
    // `inline` is the rectangle a *different* plugin's point holds: the surface is never registered as
    // one of this plugin's own panes, and it appears only where an `extensions` entry places it. Nothing
    // draws it until an owner's point takes it, which is what makes "the owner consents" true of the
    // rectangle kind as well.
    target: z
      .enum(['pane', 'refPanel', 'settings', 'importer', 'webview', 'overlay', 'coreSlot', 'inline'])
      .describe(
        "What the surface is: a `pane`, a reference panel, a settings page, a project importer, a `webview`, an `overlay`, a replacement for one of acorn's own surfaces, or an `inline` rectangle for another plugin's point.",
      ),
    // Task or project, and `pane` only. `task` is the default. A property rather than another `target`,
    // because `target` picks the registry and `scope` picks which of two things a pane is. See
    // docs/panes.md § Pane scope.
    scope: z
      .enum(['task', 'project'])
      .default('task')
      .describe('For a `pane`: whether it belongs to a task, or to a project beside your rail list.'),
    // Not namespaced by us: it becomes a persisted layout key the moment a user opens the pane, so
    // prefixing it later would break stored layouts.
    id: z
      .string()
      .min(1)
      .max(64)
      .describe(
        "The surface's ID, unique in this manifest. A pane's ID is stored in people's layouts, so don't rename it.",
      ),
    label: z
      .string()
      .min(1)
      .max(80)
      .describe("The surface's name, in the pane switcher, Settings, or the trust prompt."),
    // A Lucide name, resolved client-side; an unmatched name renders as-is.
    glyph: z.string().min(1).max(64).default('puzzle').describe('A Lucide icon name, or a `brand:` mark.'),
    order: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(500)
      .describe('Where it sits among its siblings. Lower comes first.'),
    // A diagnostic pane can stay addressable by a command without occupying the everyday switcher.
    showInSwitcher: z
      .boolean()
      .optional()
      .describe('Set `false` to leave a pane out of the switcher, so only a command opens it.'),
    // A task pane that can draw entirely from stored history may opt into archived-task previews.
    // Absent is deliberately false: archived tasks have no worktree, and mounting an ordinary pane
    // may otherwise start work that the owner did not restore.
    readsArchived: z
      .boolean()
      .optional()
      .describe('For a task pane that draws only from stored history: show it on archived tasks too.'),
    // Task `pane` only. The owner's consent for other plugins to put status marks on this pane's
    // switcher button through `core:pane` (`CORE_PANE_POINT`). Absent means no marks.
    statusAnnotations: z
      .boolean()
      .optional()
      .describe(
        'For a task pane: let other plugins put status marks on its switcher button, through the `core:pane` point.',
      ),
    // Task `pane` only. A GET route that answers `{ [taskId]: boolean }` for the node's active tasks, so
    // the host can hide the pane on a task it has nothing to draw for. A task the answer leaves out is
    // hidden too. See docs/panes/contributions.md § Contributions.
    availability: pluginRoute
      .optional()
      .describe(
        'For a task pane: a GET route that answers `{ [taskId]: boolean }`, so the pane hides on tasks it has nothing for. A task left out is hidden too.',
      ),
    // Lets a mobile shell skip a desktop-shaped pane instead of rendering it unusably.
    formFactor: z
      .array(z.enum(['desktop', 'mobile']))
      .min(1)
      .max(2)
      .default(['desktop'])
      .describe('The screen sizes the surface works at.'),
    // `refPanel` and task-scoped `pane`. The client adapter checks it against the plugin id: a surface
    // may only name its own provider. On a task pane it additionally marks the pane as a linked-items
    // view, hidden on tasks with no link from that provider.
    providerId: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'For a reference panel or task pane: the integration it shows items from. A task pane with one hides on tasks with no link from that integration.',
      ),
    // `settings` only. A coarser placement than the two fields below, still read: `workspace` makes a
    // workspace page, `general` leaves both fields below at their defaults.
    group: z
      .enum(['general', 'workspace'])
      .optional()
      .describe('For `settings`: `workspace` makes a workspace settings page.'),
    // `settings` only. Which rail group the page sits in, `features` when absent, and what a change on it
    // affects, `node` when absent. `settingsScope` rather than `scope`, because `scope` above is a pane's
    // and widening its enum would make an older node refuse this manifest outright.
    //
    // A value outside the list is caught rather than refused: the page still registers, in its default
    // place, and node-core's `parsePluginManifest` reports the value. Refusing would drop the whole
    // plugin over where one page is filed.
    category: z
      .enum(PLUGIN_SETTINGS_CATEGORIES)
      .optional()
      .catch(undefined)
      .describe(
        'For `settings`: the Settings group the page sits in. Defaults to Features, and an unknown value is reported and ignored.',
      ),
    settingsScope: z
      .enum(SETTINGS_SCOPES)
      .optional()
      .catch(undefined)
      .describe('For `settings`: what a change on the page affects. Defaults to `node`.'),
    // `settings` only. What search matches besides the page's label, and the page's `SettingsSection`
    // anchors, each a search result and a deep-link target (`settings/<page>#<section>`). Caught like the
    // two above: a list past the limit costs the page its search entries, never the page.
    keywords: settingsKeywords.optional().catch(undefined),
    sections: z
      .array(
        z.object({
          id: z
            .string()
            .regex(SETTINGS_SECTION_ID_RE)
            .describe("The section's anchor, matching a `SettingsSection` on the page."),
          label: z.string().min(1).max(80).describe("The section's name in search results."),
          keywords: settingsKeywords.optional(),
        }),
      )
      .max(SETTINGS_SEARCH_MAX)
      // An id is an anchor, so two alike would leave one section unreachable, and the device refuses the list.
      .refine((list) => new Set(list.map((section) => section.id)).size === list.length)
      .optional()
      .catch(undefined)
      .describe("For `settings`: the page's sections, each a search result and a link target. IDs must differ."),
    // `settings` only. This plugin's own sources whose **Show in left rail** switch the host draws above
    // the page, in the plugin's source order (docs/frontend/rail-and-routing.md § Rail source visibility). Caught like
    // the lists above. An id that names no source of this plugin is reported by the manifest reader and
    // dropped on the device, because the host draws a switch only for a plugin's own source.
    railSourceVisibility: z
      .array(z.string().min(1).max(64))
      .max(RAIL_SOURCE_VISIBILITY_MAX)
      .optional()
      .catch(undefined)
      .describe('For `settings`: your own sources that get a **Show in left rail** switch above the page.'),
    // `coreSlot` only, and required there. An unknown slot is a parse error.
    coreSlot: z
      .enum(CORE_EXCLUSIVE_SLOTS)
      .optional()
      .describe(
        "For `coreSlot`, and required there: which of acorn's surfaces you offer to draw. The person chooses it in Settings, and acorn draws its own again if yours fails.",
      ),
    // A chrome replacement declares whether it places the one host-filled nested slot. Settings can
    // warn before selection when it deliberately leaves task navigation or status items out.
    placesSlots: z
      .array(z.enum(['rail.taskList', 'topbar.right']))
      .max(1)
      .optional()
      .describe(
        'For a `rail` or `topbar` replacement: the nested slot your surface places, so Settings can warn when you leave it out.',
      ),
    // `webview` only. The declared hosts are the grant the device records and Electron enforces across
    // redirects.
    url: z
      .string()
      .min(1)
      .max(2_048)
      .optional()
      .describe('For `webview`: the page it opens. Give `url` or `urlSource`, not both.'),
    urlSource: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'For `webview`: a route on your Node half that answers `{ url }`, when the start page depends on the task.',
      ),
    hosts: z
      .array(webviewHost)
      .min(1)
      .max(WEBVIEW_HOST_MAX_COUNT)
      .optional()
      .describe(
        'For `webview`, and required there: the hosts the page may visit, including through redirects. The trust prompt lists them.',
      ),
    // `pane` only. Absent means a plain frame fills the whole pane. Present, the host draws the
    // arrangement and fills each region from `regions` below (`PANE_LAYOUTS`).
    layout: z
      .enum(PANE_LAYOUTS)
      .optional()
      .describe(
        "For a `pane`: the host's arrangement, filled from `regions`. Leave it out for one frame that fills the pane.",
      ),
    // `pane` only, and only alongside `layout`. Keys are region names the layout has; the cross-check
    // is in the refinement below, where both fields are visible.
    regions: z
      .record(z.string().min(1).max(64), paneRegionSource)
      .optional()
      .describe(
        'With `layout`: what fills each of the layout\'s regions, by region name: `"frame"`, a `remote` tree, or a `document`.',
      ),
    // `list-detail` panes only. A loaded tree cannot read host collapse state to author rail rows, so
    // this always collapses to an empty rail, leaving only the host-owned expand control.
    collapsible: z.boolean().optional().describe('For a `list-detail` pane: let the person collapse the list.'),
    // Chords the frame may keep instead of forwarding to the shell. Runtime code may narrow this list,
    // never widen it; declaring the upper bound makes the capture visible before code runs.
    claimsKeys: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .superRefine((value, ctx) => {
            if (isReservedPluginKeyClaim(value)) {
              ctx.addIssue({ code: 'custom', message: `${value} is reserved by acorn and cannot be claimed` })
            } else if (!isPluginKeyClaim(value)) {
              ctx.addIssue({ code: 'custom', message: 'claimed keys must be canonical chords with meta, ctrl, or alt' })
            }
          }),
      )
      .max(32)
      .default([])
      .describe(
        "Shortcuts your frame keeps instead of passing to acorn. Each needs meta, ctrl, or alt, and acorn's own are refused. Your code may claim fewer, never more.",
      ),
    // The only cross-owner UI effect a loaded tree may request. Each id maps to one target kind the
    // manifest disclosed; the runtime supplies only the bounded resource id.
    destinations: z
      .array(navigationDestination)
      .max(8)
      .default([])
      .describe('Views in other plugins your tree may ask to open, each named here so the trust prompt shows it.'),
  })
  .superRefine((surface, ctx) => {
    const destinationIds = new Set<string>()
    for (const [index, destination] of surface.destinations.entries()) {
      if (destinationIds.has(destination.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['destinations', index, 'id'],
          message: `duplicate destination id '${destination.id}'`,
        })
      }
      destinationIds.add(destination.id)
    }
    // The one cross-field rule a surface can check on its own: a layout has the regions it has. The
    // client repeats it over a roster row (`paneLayoutFor`), because a manifest reaches a device as
    // bytes a node sent.
    if (surface.regions && !surface.layout) {
      ctx.addIssue({ code: 'custom', path: ['regions'], message: 'regions need a layout to name them' })
      return
    }
    if (surface.collapsible && (surface.target !== 'pane' || surface.layout !== 'list-detail')) {
      ctx.addIssue({
        code: 'custom',
        path: ['collapsible'],
        message: 'collapsible is only valid on a list-detail pane',
      })
    }
    if (surface.railSourceVisibility && surface.target !== 'settings') {
      ctx.addIssue({
        code: 'custom',
        path: ['railSourceVisibility'],
        message: 'railSourceVisibility is only valid on a settings surface',
      })
    }
    if (surface.readsArchived && (surface.target !== 'pane' || surface.scope !== 'task')) {
      ctx.addIssue({ code: 'custom', path: ['readsArchived'], message: 'readsArchived is only valid on a task pane' })
    }
    if (surface.statusAnnotations && (surface.target !== 'pane' || surface.scope !== 'task')) {
      ctx.addIssue({
        code: 'custom',
        path: ['statusAnnotations'],
        message: 'statusAnnotations is only valid on a task pane',
      })
    }
    if (surface.availability && (surface.target !== 'pane' || surface.scope !== 'task')) {
      ctx.addIssue({ code: 'custom', path: ['availability'], message: 'availability is only valid on a task pane' })
    }
    // These host-driven surfaces carry changing data and verbs. A rectangle cannot receive that
    // contract, so only a remote tree may offer them. `rail.taskList` also accepts an iframe provider.
    if (surface.target === 'coreSlot' && surface.coreSlot && surface.coreSlot !== 'rail.taskList') {
      const body = surface.regions?.body
      if (surface.layout !== 'single' || !body || typeof body !== 'object' || body.kind !== 'remote') {
        ctx.addIssue({
          code: 'custom',
          path: ['regions'],
          message: `${surface.coreSlot} needs a single remote-tree body`,
        })
      }
    }
    if (surface.placesSlots?.length) {
      const expected =
        surface.coreSlot === 'rail' ? 'rail.taskList' : surface.coreSlot === 'topbar' ? 'topbar.right' : null
      if (!expected || surface.placesSlots.some((slot) => slot !== expected)) {
        ctx.addIssue({
          code: 'custom',
          path: ['placesSlots'],
          message: 'placesSlots must name the nested slot for this chrome surface',
        })
      }
    }
    if (!surface.layout) return
    const problem = regionProblem(surface.layout, Object.keys(surface.regions ?? {}))
    if (problem) ctx.addIssue({ code: 'custom', path: ['regions'], message: problem })
  })
