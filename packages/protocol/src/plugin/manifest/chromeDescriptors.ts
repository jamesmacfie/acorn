import { z } from 'zod'
import { CONTEXT_MENU_LOCATIONS, unknownWhenFacts } from '../../chrome/contextMenus.ts'
import { dashboardViewKinds } from '../../dashboards/dashboardViews.ts'
import { pluginRoute } from './manifestFields.ts'

// ── Declarative chrome ────────────────────────────────────────────────────────────────────────────
//
// These descriptors contain static data or paths into the plugin's route namespace. The host draws
// them from the plugin's node responses. The node's manifest refinement confines routes using `id`.
// See docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels.

// The closed verb set the host executes for a descriptor. `invoke`, an RPC into the plugin's frame,
// isn't here: it needs a headless frame lifecycle the shell doesn't have.

export const chromeAction = z.discriminatedUnion('verb', [
  // A pane the same manifest declares under `frames`, checked by the node's manifest refinement. The clicked row's id rides along
  // as a pane intent (client-core/host/registries/commands/clientEvents.ts).
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  // Go to the task the click names and stop there, for a row whose thing IS a task. Only a dashboard
  // row carries one, so elsewhere the host refuses it out loud.
  z.object({ verb: z.literal('openTask') }),
  // A project-scoped pane the same manifest declares, reached by navigating to the route declared for
  // it. Separate from `openPane` because `openPane` mutates a task's persisted layout and this changes
  // the URL, which also keeps `openPane`'s "open a task first" refusal honest.
  z.object({ verb: z.literal('navigate'), surface: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  // Host-owned promotion. The selected rail row carries the seed; the verb carries no plugin
  // callbacks, so it survives the descriptor boundary.
  z.object({ verb: z.literal('createTask') }),
  // https only, opened in the real browser rather than in-app (docs/shell.md § Navigation policy).
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
  // An `overlay` surface the same manifest declares, checked by the node. It's in both unions because an
  // overlay covers the window and belongs to no task's layout, so it needs nothing from its click
  // site.
  z.object({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  // A composed pane the same manifest declares, checked by the node. The only verb whose effect lands inside a
  // plugin rather than on the shell. It exists for a chord the plugin can't receive: in a
  // `document-over-frame` pane, Cmd+Enter is pressed in the host's editor where the frame has no
  // keyboard. Naming the surface rather than deriving it from the keybinding keeps the command
  // palette-usable.
  z.object({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

// Seconds. A fallback for data that changes with no node-side trigger; the primary freshness path is
// `ctx.events.status()`. Floored so a descriptor can't busy-loop against a remote node.
export const refresh = z.number().int().min(30).max(86_400).optional()

// `createTask` needs a selected rail row and `navigate` a routed project, and a command registry row
// has neither in scope.
export const contextFreeAction = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  // Go to a task and stop there. Only a dashboard record carries the task it means, so
  // from a command or a badge this verb has nothing to aim at and the host says so.
  z.object({ verb: z.literal('openTask') }),
  z.object({ verb: z.literal('runNodeAction'), path: pluginRoute }),
  z.object({ verb: z.literal('openUrl'), url: z.string().url() }),
  z.object({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  z.object({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

// The same set plus `navigate`, for the one click site that has what `navigate` wants.
//
// A search row is a selected row, and a project-scoped search ran because the session had a routed
// project, so both halves of the address exist here where they do not on a plain command
// (docs/plugins.md § Command kinds). `createTask` is still absent: a
// search result is a thing to go and look at, and promoting one is a second verb on the row rather
// than what picking it means (docs/integrations.md § From the command palette).
export const selectedRowAction = z.discriminatedUnion('verb', [
  ...contextFreeAction.options,
  z.object({ verb: z.literal('navigate'), surface: z.string().min(1).max(64) }),
])

// What an empty rail says, and where it can send someone. One action, no markup, bounded message: this
// is the field that invites a source to grow an onboarding flow. See docs/plugins.md.
export const emptyStateDescriptor = z.object({
  message: z.string().min(1).max(160),
  action: contextFreeAction.optional(),
  // Absent means the message renders alone, which is legitimate: linear's empty state points at a
  // settings page no verb in this union can reach.
  actionLabel: z.string().min(1).max(40).optional(),
})

// ── A reserved panel region ───────────────────────────────────────────────────────────────────────
//
// A plugin declares that part of one of its surfaces is a dashboard, and what a person may compose
// there. The host draws the region; the plugin's layout only reserves it. Constraints are enforced
// twice: the panel editor doesn't offer a disallowed option, and the host re-checks at render time
// because a manifest-derived roster row is untrusted wire.
// See docs/dashboards.md § Placements and docs/plugins.md § Cooperative extension points.
export const panelRegion = z.object({
  // Which sources a panel here may be composed over. Absent means this plugin's own; present, it's
  // an explicit list of `<pluginId>:<sourceId>`. References remain stable while providers are absent.
  sources: z.array(z.string().min(1).max(200)).max(16).optional(),
  // Or, instead of a list, "any source carrying a field with this role". `status` admits every
  // provider that declares a status-role field, including ones installed after this manifest.
  fieldRole: z.enum(['title', 'status', 'assignee', 'url', 'updated']).optional(),
  // Which views may be composed here. Absent means all of them.
  views: z.array(z.enum(dashboardViewKinds)).min(1).max(dashboardViewKinds.length).optional(),
  // How many panels fit. A region is a corner of somebody else's surface, so the owner sets a ceiling.
  max: z.number().int().min(1).max(12).default(4),
}).superRefine((region, ctx) => {
  // A list and a role requirement answer the same question two ways, so honouring both would mean
  // inventing an and/or the declaration doesn't state.
  if (region.sources && region.fieldRole) {
    ctx.addIssue({ code: 'custom', path: ['fieldRole'], message: 'a panel region names sources or a fieldRole, never both' })
  }
})

export const sourceDescriptor = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  glyph: z.string().min(1).max(64).default('puzzle'),
  // Required, like SourceContribution.order. Rail position is declared, never derived from plugin
  // load order (registries/sources.ts).
  order: z.number().int().min(0).max(100_000),
  // Optional gate on a connected integration, same as a first-party source.
  providerId: z.string().min(1).max(64).optional(),
  // A Node-backed source reads the plugin's route. A client-only source supplies both browse
  // regions from its remote-tree worker instead, so no Node handler is needed.
  items: pluginRoute.optional(),
  tree: z.object({
    list: z.string().min(1).max(64),
    detail: z.string().min(1).max(64),
  }).strict().optional(),
  // Does this rail read the routed project? Opt in, so an older manifest and a plugin that never
  // thought about projects both land on `false`, which is true of most of them. Declaring it turns on
  // the shell's project picker for this source and adds `?project=` to the items route
  // (client-core/host/chrome/ChromeSourcePanel.tsx).
  projectScoped: z.boolean().optional(),
  // The pane a task this source tracks opens on the first time it is activated
  // (client-core/host/registries/sources/sources.ts). Has to be one of this plugin's own declared task
  // panes, re-checked on the device the way a content link's `openPane` is.
  defaultPane: z.string().min(1).max(64).optional(),
  onSelect: chromeAction.optional(),
  // Shown when the route answered with no items, not when it failed. An unreachable node has its own
  // banner, and "nothing is assigned to you" after a timeout is a lie told on the plugin's behalf.
  emptyState: emptyStateDescriptor.optional(),
  // A dashboard region beside this source's rail list, composed by the user under the constraints above.
  // Mutually exclusive with a `navigate` onSelect, checked in node-core/server/plugins/manifest.ts: the
  // detail half of a master/detail browse occupies the same rectangle.
  panels: panelRegion.optional(),
  refresh,
}).superRefine((source, ctx) => {
  if (Number(source.items !== undefined) + Number(source.tree !== undefined) !== 1) {
    ctx.addIssue({ code: 'custom', message: 'a source needs either an items route or a remote tree' })
  }
  if (source.tree && (source.onSelect || source.emptyState || source.panels)) {
    ctx.addIssue({ code: 'custom', message: 'a remote-tree source owns its selection, empty state, and detail region' })
  }
})

export const slotDescriptor = z.object({
  id: z.string().min(1).max(64),
  // Enumerated host slots, so an unknown one is a parse error rather than a contribution that never
  // appears. Short, because a slot opened is hard to close. docs/plugins.md § Descriptors for chrome,
  // frames for rectangles has the table, including every slot that was refused and why.
  slot: z.enum(['footer', 'topbar']),
  icon: z.string().min(1).max(64).optional(),
  // GET → PluginSlotBadge | null, where null hides the badge.
  data: pluginRoute,
  onClick: contextFreeAction.optional(),
  refresh,
})

// A row on a host-drawn context menu (@acorn/protocol/contextMenus.ts holds the location vocabulary and
// the facts a `when` may name). Takes the narrow `contextFreeAction` union: the thing under the cursor
// is a core resource, and the two missing verbs both need something only a rail source has.
// See docs/plugins.md § Context menus.
export const contextMenuDescriptor = z.object({
  id: z.string().min(1).max(64),
  location: z.enum(CONTEXT_MENU_LOCATIONS),
  label: z.string().min(1).max(60),
  // A Lucide name or a `brand:` mark, resolved client-side, exactly as a source's `glyph` is.
  icon: z.string().min(1).max(64).optional(),
  order: z.number().int().min(0).max(100_000).default(500),
  // All-must-equal over the location's own facts. A value is a literal, not a pattern.
  when: z.record(z.string().min(1).max(32), z.union([z.string().max(64), z.boolean()])).optional(),
  action: contextFreeAction,
}).superRefine((descriptor, ctx) => {
  // A `when` naming a fact the host never supplies can never match, which is the "installs and does
  // nothing" failure that's worse than a parse error because it looks like it worked.
  for (const fact of unknownWhenFacts(descriptor.location, descriptor.when ?? {})) {
    ctx.addIssue({ code: 'custom', path: ['when', fact], message: `'${descriptor.location}' has no fact named '${fact}'` })
  }
})
