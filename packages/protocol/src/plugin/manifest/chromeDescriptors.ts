import { z } from 'zod'
import { CONTEXT_MENU_LOCATIONS, unknownWhenFacts } from '../../chrome/contextMenus.ts'
import { dashboardViewKinds } from '../../dashboards/dashboardViews.ts'
import { pluginRoute } from './manifestFields.ts'

// ── Declarative chrome ────────────────────────────────────────────────────────────────────────────
//
// These descriptors contain static data or paths into the plugin's route namespace. The host draws
// them from the plugin's node responses. The node's manifest refinement confines routes using `id`.
// See docs/plugins/ui-tiers.md § Descriptors for facts, trees for UI, rectangles for pixels.

// The closed verb set the host executes for a descriptor. `invoke`, an RPC into the plugin's frame,
// isn't here: it needs a headless frame lifecycle the shell doesn't have.

// Each verb once, so the three sets below share one definition and one description.
const surfaceId = (text: string) => z.string().min(1).max(64).describe(text)

// A pane the same manifest declares under `frames`, checked by the node's manifest refinement. The
// clicked row's id rides along as a pane intent (the `presentation:pane-intent` client event).
const openPaneAction = z.object({
  verb: z
    .literal('openPane')
    .describe("Opens one of your task panes in the open task. The clicked row's ID goes with it."),
  pane: surfaceId('The ID of a `pane` this manifest declares under `frames`.'),
})
// Go to the task the click names and stop there, for a row whose thing IS a task. Only a dashboard
// row carries one, so elsewhere the host refuses it out loud.
const openTaskAction = z.object({
  verb: z
    .literal('openTask')
    .describe(
      'Goes to the task the clicked row names. Only a dashboard row names one, and a row that names no task gets a toast saying so.',
    ),
})
// A project-scoped pane the same manifest declares, reached by navigating to the route declared for
// it. Separate from `openPane` because `openPane` mutates a task's persisted layout and this changes
// the URL, which also keeps `openPane`'s "open a task first" refusal honest.
const navigateAction = z.object({
  verb: z
    .literal('navigate')
    .describe(
      'Goes to one of your project panes for the clicked row, at the address its `routes` entry declares. Needs a selected row and a project.',
    ),
  surface: surfaceId("The ID of a `scope: 'project'` pane this manifest declares."),
})
const runNodeActionAction = z.object({
  verb: z
    .literal('runNodeAction')
    .describe(
      'POSTs to a route on your Node half. The body says what was clicked, and its shape depends on where the action sits.',
    ),
  path: pluginRoute.describe('The route to POST, one of your own.'),
})
// Host-owned promotion. The selected rail row carries the seed; the verb carries no plugin
// callbacks, so it survives the descriptor boundary.
const createTaskAction = z.object({
  verb: z
    .literal('createTask')
    .describe("Starts a new task from the selected rail row. Only a rail source's `onSelect` takes it."),
})
// https only, opened in the real browser rather than in-app (docs/shell/origins.md § Navigation policy).
const openUrlAction = z.object({
  verb: z.literal('openUrl').describe("Opens an address in the person's browser, not inside acorn."),
  url: z.string().url().describe('The address to open. Only `https` opens.'),
})
// An `overlay` surface the same manifest declares, checked by the node. It's in every set because an
// overlay covers the window and belongs to no task's layout, so it needs nothing from its click site.
const openOverlayAction = z.object({
  verb: z.literal('openOverlay').describe('Opens one of your overlays over the window.'),
  overlay: surfaceId('The ID of an `overlay` this manifest declares under `frames`.'),
})
// A composed pane the same manifest declares, checked by the node. The only verb whose effect lands
// inside a plugin rather than on the shell. It exists for a chord the plugin can't receive: in a
// `document-over-frame` pane, Cmd+Enter is pressed in the host's editor where the frame has no
// keyboard. Naming the surface rather than deriving it from the keybinding keeps the command
// palette-usable.
const surfaceActionAction = z.object({
  verb: z
    .literal('surfaceAction')
    .describe(
      "Sends the command's ID to a frame or tree region of one of your panes, for a shortcut pressed where your pane has no keyboard, such as in a document region's editor.",
    ),
  surface: surfaceId('The ID of a pane this manifest declares.'),
})

export const chromeAction = z.discriminatedUnion('verb', [
  openPaneAction,
  openTaskAction,
  navigateAction,
  runNodeActionAction,
  createTaskAction,
  openUrlAction,
  openOverlayAction,
  surfaceActionAction,
])

// Seconds. A fallback for data that changes with no node-side trigger; the primary freshness path is
// `ctx.events.status()`. Floored so a descriptor can't busy-loop against a remote node.
export const refresh = z
  .number()
  .int()
  .min(30)
  .max(86_400)
  .optional()
  .describe(
    'Seconds between rereads of the route, at least 30. A fallback: push changes with `ctx.events.status()` instead of polling.',
  )

// `createTask` needs a selected rail row and `navigate` a routed project, and a command registry row
// has neither in scope.
export const contextFreeAction = z.discriminatedUnion('verb', [
  openPaneAction,
  openTaskAction,
  runNodeActionAction,
  openUrlAction,
  openOverlayAction,
  surfaceActionAction,
])

// The same set plus `navigate`, for the one click site that has what `navigate` wants.
//
// A search row is a selected row, and a project-scoped search ran because the session had a routed
// project, so both halves of the address exist here where they do not on a plain command
// (docs/plugins/commands.md § Command kinds). `createTask` is still absent: a
// search result is a thing to go and look at, and promoting one is a second verb on the row rather
// than what picking it means (docs/integrations.md § From the command palette).
export const selectedRowAction = z.discriminatedUnion('verb', [...contextFreeAction.options, navigateAction])

// What an empty rail says, and where it can send someone. One action, no markup, bounded message: this
// is the field that invites a source to grow an onboarding flow. See docs/plugins.md.
export const emptyStateDescriptor = z.object({
  message: z.string().min(1).max(160).describe('What the rail says when your route answers with no items. Plain text.'),
  action: contextFreeAction.optional().describe('One action the empty rail offers, as a button.'),
  // Absent means the message renders alone, which is legitimate: linear's empty state points at a
  // settings page no verb in this union can reach.
  actionLabel: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe("The button's label. Without it, the message shows alone."),
})

// ── A reserved panel region ───────────────────────────────────────────────────────────────────────
//
// A plugin declares that part of one of its surfaces is a dashboard, and what a person may compose
// there. The host draws the region; the plugin's layout only reserves it. Constraints are enforced
// twice: the panel editor doesn't offer a disallowed option, and the host re-checks at render time
// because a manifest-derived roster row is untrusted wire.
// See docs/dashboards/placements.md § Placements and docs/plugins/cooperative-extension-points.md § Cooperative extension points.
export const panelRegion = z
  .object({
    // Which sources a panel here may be composed over. Absent means this plugin's own; present, it's
    // an explicit list of `<pluginId>:<sourceId>`. References remain stable while providers are absent.
    sources: z
      .array(z.string().min(1).max(200))
      .max(16)
      .optional()
      .describe(
        "The sources a panel here may be built from, as `<pluginId>:<sourceId>`. Leave it out for your own sources. Don't set it with `fieldRole`.",
      ),
    // Or, instead of a list, "any source carrying a field with this role". `status` admits every
    // provider that declares a status-role field, including ones installed after this manifest.
    fieldRole: z
      .enum(['title', 'status', 'assignee', 'url', 'updated'])
      .optional()
      .describe('Instead of `sources`: any source with a field in this role, including ones installed later.'),
    // Which views may be composed here. Absent means all of them.
    views: z
      .array(z.enum(dashboardViewKinds))
      .min(1)
      .max(dashboardViewKinds.length)
      .optional()
      .describe('The views a person may pick for a panel here. Leave it out to allow every view.'),
    // How many panels fit. A region is a corner of somebody else's surface, so the owner sets a ceiling.
    max: z.number().int().min(1).max(12).default(4).describe('How many panels fit in the region.'),
  })
  .superRefine((region, ctx) => {
    // A list and a role requirement answer the same question two ways, so honouring both would mean
    // inventing an and/or the declaration doesn't state.
    if (region.sources && region.fieldRole) {
      ctx.addIssue({
        code: 'custom',
        path: ['fieldRole'],
        message: 'a panel region names sources or a fieldRole, never both',
      })
    }
  })

export const sourceDescriptor = z
  .object({
    id: z.string().min(1).max(64).describe("The source's ID, unique in this manifest."),
    label: z.string().min(1).max(80).describe("The source's name on the rail and in the palette."),
    glyph: z
      .string()
      .min(1)
      .max(64)
      .default('puzzle')
      .describe('A Lucide icon name, or a `brand:` mark, for the rail.'),
    // Required, like SourceContribution.order. Rail position is declared, never derived from plugin
    // load order.
    order: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .describe('Where the source sits on the rail. Lower comes first. Required, because load order never decides it.'),
    // Optional gate on a connected integration, same as a first-party source.
    providerId: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Shows the source only while this integration is connected.'),
    // A Node-backed source reads the plugin's route. A client-only source supplies both browse
    // regions from its remote-tree worker instead, so no Node handler is needed.
    items: pluginRoute
      .optional()
      .describe("A GET route on your Node half that answers the rail's rows. Give `items` or `tree`, not both."),
    // A provider search over the same list, answering `PluginRailSearchResult`. The host sends the
    // reader's `q` and the routed `?project=` the items route gets, and keeps the list's `onSelect` for
    // every answered row (docs/plugins/descriptors.md § Searching a source).
    search: pluginRoute
      .optional()
      .describe("A GET route that searches the same list, sent the person's `q`. Needs `items`."),
    tree: z
      .object({
        list: z.string().min(1).max(64).describe('The `mountTree` entry that draws the list.'),
        detail: z.string().min(1).max(64).describe("The `mountTree` entry that draws the selected row's detail."),
      })
      .strict()
      .optional()
      .describe(
        'Two trees from your client bundle that draw the list and its detail, for a source with no Node half. Give `items` or `tree`, not both.',
      ),
    // Does this rail read the routed project? Opt in, so an older manifest and a plugin that never
    // thought about projects both land on `false`, which is true of most of them. Declaring it turns on
    // the shell's project picker for this source and adds `?project=` to the items route
    // (client-core's `ChromeSourcePanel`).
    projectScoped: z
      .boolean()
      .optional()
      .describe(
        'Set it when the list depends on the open project. The rail then shows a project picker and sends `?project=` to `items`.',
      ),
    // Whether the desktop rail draws this source's icon before the user has chosen. Absent means `true`,
    // so every older manifest keeps its icon. A default, not a gate: the source still registers and
    // opens from the palette, and the user's switch in Settings wins over it (client-core's
    // `shownInRail`).
    showInRailByDefault: z
      .boolean()
      .optional()
      .describe("Whether the desktop rail shows the source's icon before the person chooses. Defaults to `true`."),
    // Draw this source only while the active workspace has a project that is a git repository. For a
    // source about git itself, whose rail would sit empty in a workspace of plain folders. Absent means
    // the source draws whatever the workspace holds (client-core's `availableSources`).
    requiresGitProject: z
      .boolean()
      .optional()
      .describe("Shows the source only while the workspace has a project that's a Git repository."),
    // The owner's consent for other plugins to put status marks on this source's rail icon through
    // `core:source` (`CORE_SOURCE_POINT`). Absent means no marks.
    statusAnnotations: z
      .boolean()
      .optional()
      .describe("Lets other plugins put status marks on the source's rail icon, through the `core:source` point."),
    // The pane a task this source tracks opens on the first time it is activated (client-core's
    // `defaultPaneForTask`). Has to be one of this plugin's own declared task panes, re-checked on the
    // device the way a content link's `openPane` is.
    defaultPane: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'The task pane a task from this source opens on the first time. It must be one of your own task panes.',
      ),
    onSelect: chromeAction.optional().describe('What picking a row does. It takes every action verb.'),
    // Shown when the route answered with no items, not when it failed. An unreachable node has its own
    // banner, and "nothing is assigned to you" after a timeout is a lie told on the plugin's behalf.
    emptyState: emptyStateDescriptor
      .optional()
      .describe("What the rail says when `items` answers with no rows. It isn't shown when the route fails."),
    // A dashboard region beside this source's rail list, composed by the user under the constraints above.
    // Mutually exclusive with a `navigate` onSelect, checked by node-core's `pluginManifestSchema`: the
    // detail half of a master/detail browse occupies the same rectangle.
    panels: panelRegion
      .optional()
      .describe(
        'A dashboard region beside the list, which the person fills with panels. Not with a `navigate` `onSelect`.',
      ),
    // Live artwork and words on the rail button, read while the button is drawn, whatever source is
    // open. It changes only what the button shows: identity, order and the click stay the fields
    // above (docs/plugins/rail-presentation.md § Rail presentation).
    railPresentation: z
      .strictObject({
        data: pluginRoute.describe(
          'A GET route that answers `PluginRailPresentation`: artwork and tooltip text, or `null` for the static glyph.',
        ),
        refresh,
      })
      .optional()
      .describe('Live artwork and tooltip text for the rail button, such as the cover and title of a playing song.'),
    refresh,
  })
  .superRefine((source, ctx) => {
    if (Number(source.items !== undefined) + Number(source.tree !== undefined) !== 1) {
      ctx.addIssue({ code: 'custom', message: 'a source needs either an items route or a remote tree' })
    }
    if (source.search !== undefined && source.items === undefined) {
      ctx.addIssue({ code: 'custom', message: 'a search route searches an items list, so it needs an items route' })
    }
    if (source.tree && (source.onSelect || source.emptyState || source.panels)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a remote-tree source owns its selection, empty state, and detail region',
      })
    }
  })

export const slotDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The badge's ID, unique in this manifest."),
  // Enumerated host slots, so an unknown one is a parse error rather than a contribution that never
  // appears. Short, because a slot opened is hard to close. docs/plugins/descriptors.md § Descriptors for chrome,
  // frames for rectangles has the table, including every slot that was refused and why.
  slot: z
    .enum(['footer', 'topbar'])
    .describe("Where the badge goes: `topbar`, after the notification bell, or `footer`, in a task's footer."),
  icon: z.string().min(1).max(64).optional().describe('A Lucide icon name, or a `brand:` mark.'),
  // GET → PluginSlotBadge | null, where null hides the badge.
  data: pluginRoute.describe('A GET route that answers the badge, or `null` to hide it.'),
  onClick: contextFreeAction.optional().describe('What clicking the badge does.'),
  refresh,
})

// A row on a host-drawn context menu (`CONTEXT_MENU_LOCATIONS` holds the location vocabulary, and
// `unknownWhenFacts` checks the facts a `when` may name). Takes the narrow `contextFreeAction` union: the
// thing under the cursor is a core resource, and the two missing verbs both need something only a rail source
// has. See docs/plugins/menus-and-markers.md § Context menus.
export const contextMenuDescriptor = z
  .object({
    id: z.string().min(1).max(64).describe("The row's ID, unique in this manifest."),
    location: z.enum(CONTEXT_MENU_LOCATIONS).describe('Which menu the row goes on.'),
    // Required for rail locations. The node and client verify ownership against declared surfaces.
    surface: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'For a rail location, which of your own sources the menu belongs to. Required there, and not used elsewhere.',
      ),
    label: z.string().min(1).max(60).describe("The row's text."),
    // A Lucide name or a `brand:` mark, resolved client-side, exactly as a source's `glyph` is.
    icon: z.string().min(1).max(64).optional().describe('A Lucide icon name, or a `brand:` mark.'),
    order: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(500)
      .describe("Where the row sits. acorn's own rows come first unless yours is lower."),
    // All-must-equal over the location's own facts. A value is a literal, not a pattern.
    when: z
      .record(z.string().min(1).max(32), z.union([z.string().max(64), z.boolean()]))
      .optional()
      .describe(
        'Facts the target must match for the row to show, such as `{ "extension": "md" }`. Every value must equal the target\'s, with no patterns. A fact the location doesn\'t have is refused.',
      ),
    action: contextFreeAction.describe('What the row does. It gets the ID of what was right-clicked.'),
  })
  .superRefine((descriptor, ctx) => {
    // A `when` naming a fact the host never supplies can never match, which is the "installs and does
    // nothing" failure that's worse than a parse error because it looks like it worked.
    for (const fact of unknownWhenFacts(descriptor.location, descriptor.when ?? {})) {
      ctx.addIssue({
        code: 'custom',
        path: ['when', fact],
        message: `'${descriptor.location}' has no fact named '${fact}'`,
      })
    }
  })
