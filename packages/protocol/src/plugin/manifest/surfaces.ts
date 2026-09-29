import { z } from 'zod'
import { CORE_EXCLUSIVE_SLOTS } from '../../chrome/extensionPoints.ts'
import { isPluginKeyClaim, isReservedPluginKeyClaim } from '../../chrome/keybindings.ts'
import { LANGUAGE_IDS } from '../../content/languageIds.ts'
import { PANE_LAYOUTS, regionProblem } from '../../chrome/paneLayouts.ts'
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
  route: pluginRoute,
  // What re-opens the popup mid-word, beyond the editor's own identifier rule. Punctuation, not a
  // grammar.
  triggerCharacters: z.array(z.string().min(1).max(2)).max(8).default([]),
})

export const documentRegion = z.object({
  // From the published vocabulary, so an unknown id is a parse error rather than a document that
  // quietly renders as plain text. LSP's spellings (@acorn/protocol/languageIds.ts).
  languageId: z.enum(LANGUAGE_IDS).default('plaintext'),
  // GET -> { text }. The host substitutes `:taskId` and `:projectId` from the pane's scope. No other
  // parameter, because no other one is the host's to know.
  read: pluginRoute,
  // PUT { text }. Absent means read-only, which is a real mode: a generated migration or a rendered
  // template in a highlighted viewer wants exactly that.
  write: pluginRoute.optional(),
  completions: documentCompletions.optional(),
})

// What fills one region of a layout. Three kinds, and the difference between them is who draws the
// pixels.
//
// `'frame'` is this plugin's own bundle in a sandboxed iframe: the plugin draws, and the host sees a
// rectangle. A `remote` region is the same bundle running in a worker with no DOM, emitting a tree of
// the host's own component names, which the host draws (docs/plugins.md § The tree contract); `entry`
// is a key of the object the bundle passed to `mountTree`. A document region is host-drawn outright:
// the plugin contributes routes and a language id, no code.
//
// Two of the three run the plugin's bytes, and both require an accepted bundle hash. The host uses
// separate frame and remote-region checks in `contract.ts`: one needs an iframe origin, the other a
// worker port. A document region needs neither.
const paneRegionSource = z.union([
  z.literal('frame'),
  z.object({ kind: z.literal('remote'), entry: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('document') }).extend(documentRegion.shape),
])

// Cooperative navigation into a surface another plugin owns. The destination is a notice-target
// kind, not a route: the owning client plugin decides how to present the resource, and the caller
// gains no API access to it. `noticeKind` is also explicit because a loaded node otherwise emits the
// quiet generic plugin kind.
export const navigationDestination = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  targetKind: z.string().min(1).max(64),
  noticeKind: z.string().min(1).max(64).optional(),
}).strict()

export const frameSurface = z.object({
  // Which registry this lands in. The shell renders them all the same way; the surrounding chrome it
  // supplies is what differs.
  //
  // `overlay` is the full-screen picker slot: the host places the rectangle and the frame draws its
  // contents. It has no click site, so `openOverlay` is the only way to open one. `coreSlot` is drawn
  // where one of core's own surfaces normally is; registering one seizes nothing, because the user
  // picks the provider in settings. See docs/plugins.md § Replacing a core surface.
  // `inline` is the rectangle a *different* plugin's point holds: the surface is never registered as
  // one of this plugin's own panes, and it appears only where an `extensions` entry places it. Nothing
  // draws it until an owner's point takes it, which is what makes "the owner consents" true of the
  // rectangle kind as well.
  target: z.enum(['pane', 'refPanel', 'settings', 'importer', 'webview', 'overlay', 'coreSlot', 'inline']),
  // Task or project, and `pane` only. `task` is the default, so every manifest written before this
  // field behaves the same. A property rather than a fifth `target`, because `target` picks the
  // registry and `scope` picks which of two things a pane is. See docs/panes.md § Pane scope.
  scope: z.enum(['task', 'project']).default('task'),
  // Not namespaced by us: it becomes a persisted layout key the moment a user opens the pane, so
  // prefixing it later would break stored layouts (registries/plugin.ts).
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  // A Lucide name, resolved client-side; an unmatched name renders as-is.
  glyph: z.string().min(1).max(64).default('puzzle'),
  order: z.number().int().min(0).max(100_000).default(500),
  // A diagnostic pane can stay addressable by a command without occupying the everyday switcher.
  showInSwitcher: z.boolean().optional(),
  // A task pane that can draw entirely from stored history may opt into archived-task previews.
  // Absent is deliberately false: archived tasks have no worktree, and mounting an ordinary pane
  // may otherwise start work that the owner did not restore.
  readsArchived: z.boolean().optional(),
  // Lets a mobile shell skip a desktop-shaped pane instead of rendering it unusably.
  formFactor: z.array(z.enum(['desktop', 'mobile'])).min(1).max(2).default(['desktop']),
  // `refPanel` and task-scoped `pane`. The client adapter checks it against the plugin id: a surface
  // may only name its own provider. On a task pane it additionally marks the pane as a linked-items
  // view, hidden on tasks with no link from that provider.
  providerId: z.string().min(1).max(64).optional(),
  // `settings` only.
  group: z.enum(['general', 'workspace']).optional(),
  // `settings` only. Sources of this same plugin whose "Show in left rail" switch the host draws above
  // this page. The host owns the switch and its preference; the page's own code never sees either.
  // Each id must name one of this manifest's `sources`, checked by the node's manifest pass and again
  // on the device.
  railSourceVisibility: z.array(z.string().min(1).max(64)).min(1).max(16).optional(),
  // `coreSlot` only, and required there. An unknown slot is a parse error.
  coreSlot: z.enum(CORE_EXCLUSIVE_SLOTS).optional(),
  // A chrome replacement declares whether it places the one host-filled nested slot. Settings can
  // warn before selection when it deliberately leaves task navigation or status items out.
  placesSlots: z.array(z.enum(['rail.taskList', 'topbar.right'])).max(1).optional(),
  // `webview` only. The declared hosts are the grant the device records and Electron enforces across
  // redirects.
  url: z.string().min(1).max(2_048).optional(),
  urlSource: z.string().min(1).max(256).optional(),
  hosts: z.array(webviewHost).min(1).max(WEBVIEW_HOST_MAX_COUNT).optional(),
  // `pane` only. Absent means a plain frame fills the whole pane. Present, the host draws the
  // arrangement and fills each region from `regions` below (@acorn/protocol/paneLayouts.ts).
  layout: z.enum(PANE_LAYOUTS).optional(),
  // `pane` only, and only alongside `layout`. Keys are region names the layout has; the cross-check
  // is in the refinement below, where both fields are visible.
  regions: z.record(z.string().min(1).max(64), paneRegionSource).optional(),
  // `list-detail` panes only. A loaded tree cannot read host collapse state to author rail rows, so
  // this always collapses to an empty rail, leaving only the host-owned expand control.
  collapsible: z.boolean().optional(),
  // Chords the frame may keep instead of forwarding to the shell. Runtime code may narrow this list,
  // never widen it; declaring the upper bound makes the capture visible before code runs.
  claimsKeys: z.array(z.string().min(1).max(64).superRefine((value, ctx) => {
    if (isReservedPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: `${value} is reserved by acorn and cannot be claimed` })
    } else if (!isPluginKeyClaim(value)) {
      ctx.addIssue({ code: 'custom', message: 'claimed keys must be canonical chords with meta, ctrl, or alt' })
    }
  })).max(32).default([]),
  // The only cross-owner UI effect a loaded tree may request. Each id maps to one target kind the
  // manifest disclosed; the runtime supplies only the bounded resource id.
  destinations: z.array(navigationDestination).max(8).default([]),
}).superRefine((surface, ctx) => {
  const destinationIds = new Set<string>()
  for (const [index, destination] of surface.destinations.entries()) {
    if (destinationIds.has(destination.id)) {
      ctx.addIssue({ code: 'custom', path: ['destinations', index, 'id'], message: `duplicate destination id '${destination.id}'` })
    }
    destinationIds.add(destination.id)
  }
  // The one cross-field rule a surface can check on its own: a layout has the regions it has. The
  // client repeats it over a roster row, because a manifest reaches a device as bytes a node sent
  // (client-core/host/frames/layouts.ts).
  if (surface.regions && !surface.layout) {
    ctx.addIssue({ code: 'custom', path: ['regions'], message: 'regions need a layout to name them' })
    return
  }
  if (surface.collapsible && (surface.target !== 'pane' || surface.layout !== 'list-detail')) {
    ctx.addIssue({ code: 'custom', path: ['collapsible'], message: 'collapsible is only valid on a list-detail pane' })
  }
  if (surface.railSourceVisibility && surface.target !== 'settings') {
    ctx.addIssue({ code: 'custom', path: ['railSourceVisibility'], message: 'railSourceVisibility is only valid on a settings surface' })
  }
  if (surface.readsArchived && (surface.target !== 'pane' || surface.scope !== 'task')) {
    ctx.addIssue({ code: 'custom', path: ['readsArchived'], message: 'readsArchived is only valid on a task pane' })
  }
  // These host-driven surfaces carry changing data and verbs. A rectangle cannot receive that
  // contract, so only a remote tree may offer them; the original task-list slot remains compatible
  // with its existing iframe providers.
  if (surface.target === 'coreSlot' && surface.coreSlot && surface.coreSlot !== 'rail.taskList') {
    const body = surface.regions?.body
    if (surface.layout !== 'single' || !body || typeof body !== 'object' || body.kind !== 'remote') {
      ctx.addIssue({ code: 'custom', path: ['regions'], message: `${surface.coreSlot} needs a single remote-tree body` })
    }
  }
  if (surface.placesSlots?.length) {
    const expected = surface.coreSlot === 'rail' ? 'rail.taskList'
      : surface.coreSlot === 'topbar' ? 'topbar.right' : null
    if (!expected || surface.placesSlots.some((slot) => slot !== expected)) {
      ctx.addIssue({ code: 'custom', path: ['placesSlots'], message: 'placesSlots must name the nested slot for this chrome surface' })
    }
  }
  if (!surface.layout) return
  const problem = regionProblem(surface.layout, Object.keys(surface.regions ?? {}))
  if (problem) ctx.addIssue({ code: 'custom', path: ['regions'], message: problem })
})
