import { z } from 'zod'

// ── What a plugin's collection route may answer ────────────────────────────────────────────────────
//
// A COLLECTION is a plugin-declared, typed set of records — "my open pull requests", "issues assigned
// to me" — that the host renders with its own components (docs/dashboards.md § Collections).
// It is the descriptor tier grown one size: from `nodeStats`' one integer with a label to a table of
// them. Declared in the manifest under `contributions.collections`, fetched and parsed by the host,
// addressed everywhere as `(pluginId, collectionId)` and by nothing else.
//
// This is the SECOND descriptor response with a real parser rather than a field-by-field sniff, and it
// is here for the same reason `agentContext.ts` is: a loaded plugin's answer is untrusted wire that the
// host renders under its own chrome, so the host owns the shape and the host is the one being handed it.
//
// ── The budget ─────────────────────────────────────────────────────────────────────────────────────
//
// The two vocabularies below — seven field types, five roles — are closed and are the whole design.
// Every type added here is a type EVERY provider's rows get rendered with and every host view has to
// know how to draw, sort, group and filter; that is the descriptor-tier slope (docs/third-party/README.md)
// of growing a contribution until it is a UI framework, and a table is much further down it than a
// state chip. Grafana ended a decade with eight field types and Notion with about a dozen properties:
// that is the budget. `duration` and `badge` were candidates and are NOT here, because neither of the
// two providers that proved this contract needed them — an unused type is a rendering rule nobody has
// checked. Both are additive later, on a versioned schema, at the cost of arguing for them.
//
// When a plugin needs something the vocabulary cannot express, the answer is a frame pane, not a wider
// wire format. Plain `z.object` throughout, so a plugin answering more has the surplus stripped rather
// than passed through.

/** Enough columns for a wide table; past this a panel is a spreadsheet, which is a frame's job. */
export const MAX_COLLECTION_FIELDS = 24
/** One page. Panels are glanceable lists, and a host that has to virtualise a plugin's answer has been
 *  handed a database export rather than a collection. */
export const MAX_COLLECTION_ROWS = 500
/** Declared values on one enum field. Past this it is free text wearing a chip. */
export const MAX_COLLECTION_ENUM_VALUES = 32
/** Declared inputs on one collection. A panel editor rendering more than a handful of them is a form. */
export const MAX_COLLECTION_PARAMS = 8
/** One cell. A row is a row, not a document — a body belongs behind the row's action. */
export const MAX_COLLECTION_CELL_CHARS = 2048

// SEMANTIC, not primitive, and that is the load-bearing choice: a semantic type is what lets the host
// render a person as an avatar and a datetime as "2h ago", and what lets it DERIVE which views a
// collection supports — only an enum can be grouped into columns, only a datetime and a number can
// carry an axis.
export const COLLECTION_FIELD_TYPES = ['text', 'number', 'boolean', 'datetime', 'enum', 'person', 'link'] as const

// A tiny SECOND vocabulary, and it exists for exactly one reason: cross-source mapping. A user
// composing one panel over two providers should not align every column by hand, so a role lets the host
// pre-fill the suggestion — "both of these have a status-role enum". Optional everywhere, because a
// field with no role is still a perfectly good column.
export const COLLECTION_FIELD_ROLES = ['title', 'status', 'assignee', 'url', 'updated'] as const

// A THIRD closed vocabulary — the views the host draws a collection with — and it lives here, on the
// wire, rather than only in the renderer because a MANIFEST now names it: a plugin reserving a panel
// region may narrow which views a user may compose there
// (docs/dashboards.md § Placements). A narrowing that named a kind
// this build has no renderer for would be a constraint nobody can satisfy, so it is an enum and an
// unknown entry is a parse error.
//
// Only the LIST is here. WHICH SCHEMA supports which view stays in @acorn/dashboards-core — that is a
// rendering rule derived from the field types above, not a wire format.
export const PANEL_VIEW_KINDS = ['stat', 'list', 'table', 'board', 'chart'] as const
export type PanelViewKind = (typeof PANEL_VIEW_KINDS)[number]

const fieldType = z.enum(COLLECTION_FIELD_TYPES)
const fieldRole = z.enum(COLLECTION_FIELD_ROLES)

// The host's own status vocabulary (client-core/ui/primitives.tsx § StatusDot), so a declared value
// lands on a colour the appearance packs already own and a plugin never names one. `mixed` is absent:
// it describes an aggregate of several states, which is a thing the host computes, not a thing a row is.
const enumValue = z.object({
  // The stable grouping key — what a kanban column is keyed by, and what a value mapping is written
  // against. Stable across refreshes and across workspaces; the LABEL is the part that may vary.
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  tone: z.enum(['ok', 'warn', 'bad', 'muted', 'accent']).optional(),
})

// Display hints hang off the FIELD, never off a panel — Grafana's `FieldConfig` lesson. A unit or a
// tone written on a panel is lost the moment the user switches from a table to a board; written here it
// survives every view, every placement and every cross-source mapping.
const collectionField = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  type: fieldType,
  role: fieldRole.optional(),
  // `number` only: "MB", "%", "d". Rendered beside the value, never parsed.
  unit: z.string().min(1).max(16).optional(),
  // `enum` only, and optional even there: a query-shaped collection cannot know its values ahead of
  // the data. Absent means the host renders the raw cell and cannot pre-tone or pre-order the groups.
  values: z.array(enumValue).max(MAX_COLLECTION_ENUM_VALUES).optional(),
}).superRefine((field, ctx) => {
  // A hint on the wrong type is a declaration that parses and can never do anything, which is the
  // failure the manifest parser spends its length refusing. Same rule, one tier down.
  if (field.unit !== undefined && field.type !== 'number') {
    ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit is only valid on a number field' })
  }
  if (field.values !== undefined && field.type !== 'enum') {
    ctx.addIssue({ code: 'custom', path: ['values'], message: 'values are only valid on an enum field' })
  }
})

export const collectionSchema = z.object({
  // No `.min(1)`: a collection with nothing to show answers with no fields and no rows, and the host's
  // own fallback for an unusable answer is the same empty page. Two spellings of "nothing" would be
  // one more thing for a panel to branch on and no more information.
  fields: z.array(collectionField).max(MAX_COLLECTION_FIELDS),
})

// Declared inputs the host renders in the panel editor and passes back through opaquely — the plugin
// owns their meaning (Grafana's opaque-target lesson). Deliberately NOT the field vocabulary above:
// a param is an input, not a rendered cell, and the two sets have no reason to move together. Two
// forms cover every case the two proving providers had, and a third is a decision rather than a drift.
const collectionParam = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  type: z.enum(['text', 'enum']),
  values: z.array(z.string().min(1).max(64)).max(MAX_COLLECTION_ENUM_VALUES).optional(),
  // `enum` only: several values at once, handed back as ONE comma-joined string. A second param TYPE
  // would have been the other spelling and is the worse one — every reader would then have two enum
  // shapes to branch on, where this way a plugin that ignores the flag still receives a string it can
  // read, and the host renders checkboxes instead of a select. The plugin owns what a union of its own
  // values means; nothing here does.
  multiple: z.boolean().optional(),
})

// One scalar per cell. `datetime` is epoch milliseconds, because that is what every other timestamp on
// this wire already is (`updatedAt`, `at`, `fetchedAt`); `null` is "this row has no value here", which
// is a different fact from an empty string and sorts differently.
const cellValue = z.union([z.string().max(MAX_COLLECTION_CELL_CHARS), z.number(), z.boolean(), z.null()])

// Re-spelled rather than imported from pluginContract.ts, which imports THIS module for its descriptor
// — a value import back would be a module cycle, and a Zod schema built at module scope does not
// survive one. The membership is the manifest's `contextFreeAction` exactly, and a row is the reason
// it is that union and not the full `chromeAction`: a panel row has no rail row to promote and no
// routed project to substitute, so `createTask` and `navigate` would parse and then do nothing.
// collections.test.ts imports both types and assigns each to the other, so the day the two drift the
// build says so.
//
// The RISK TIER, and the shape it is deliberately in. It is an ADDITIVE OPTIONAL field on the
// versioned schema — v1 shipped without it and therefore shipped no destructive row action at all,
// because an action that destroys something must not exist before arm-to-confirm does.
//
// The load-bearing part is who draws the confirmation: THE HOST DOES, from the declared tier. Never
// a new verb ("deleteThing"), and never plugin-drawn confirmation UI — a plugin that could draw its
// own dialog could also draw a reassuring one over a destructive call. A plugin declares how
// dangerous the thing is; the host decides what to ask and cannot be talked out of asking.
//
// The vocabulary is `ToolRisk` verbatim (api.ts), the tier an agent tool declares and the permission
// UI already projects. Re-spelled rather than imported for the same reason `contextFreeAction` is: a
// value import from api.ts would be a module cycle, and collections.test.ts assigns each type to the
// other so the day the two drift the build says so.
const rowRisk = z.enum(['read', 'write', 'execute'])

const withRisk = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, risk: rowRisk.optional() })

const collectionRowAction = z.discriminatedUnion('verb', [
  withRisk({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  withRisk({ verb: z.literal('runNodeAction'), path: z.string().min(1).max(256) }),
  withRisk({ verb: z.literal('openUrl'), url: z.string().url() }),
  withRisk({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  withRisk({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

const collectionRow = z.object({
  // REQUIRED, and the one field with no fallback. A mixed board dedupes across refreshes and keys its
  // rendering by this; write-back would need it later. A row with no stable identity is a row the host
  // cannot tell from a different row that happens to look the same.
  id: z.string().min(1).max(200),
  values: z.record(z.string().min(1).max(64), cellValue)
    .refine((values) => Object.keys(values).length <= MAX_COLLECTION_FIELDS, 'too many values'),
  // The task this row's thing LIVES IN, when it lives in one. A panel row was assumed to have no task
  // — it is drawn on a dashboard, which is outside every task — and that assumption is what made
  // `openPane` useless here: the verb needs a task, and the only one in scope was whichever task the
  // reader happened to have open, which is never the one the row is about.
  //
  // The row is the only thing that knows. An agent session runs in a task; a plugin listing sessions
  // knows which. So the row names it and the host TAKES THE READER THERE before running the action —
  // activate, navigate, then open the pane — which is the same two steps the attention inbox already
  // takes, and `PluginAttentionWireItem.taskId` is the same field one tier up.
  //
  // Naming a task is not the same as naming a source: provenance is stamped by the host precisely so a
  // row cannot wear a stranger's badge, whereas a task is a CORE object the host resolves itself. An
  // id no task on this node matches is refused at the click, not rendered as a broken row — the list
  // may simply not have loaded, and a row is worth showing either way.
  taskId: z.string().uuid().optional(),
  action: collectionRowAction.optional(),
})

// Responses carry their schema beside the rows (Grafana's DataFrame move). The manifest-declared schema
// is then the STATIC case — a promise about what the route returns, so the panel editor can offer views
// before any data exists — and a query-shaped collection whose columns cannot be known at manifest time
// simply declares none and self-describes here.
//
// `pluginId` and `collectionId` are ABSENT on purpose: the host stamps both from the contribution whose
// route answered, the same rule that stops a ref resolver naming another plugin's provider. A row that
// could name its own source could put a stranger's items on a board under a stranger's badge, and a
// mixed board routes row actions on that stamp.
export const pluginCollectionResponseSchema = z.object({
  schema: collectionSchema,
  rows: z.array(collectionRow).max(MAX_COLLECTION_ROWS),
})

export type PluginCollectionFieldType = z.infer<typeof fieldType>
export type PluginCollectionFieldRole = z.infer<typeof fieldRole>
export type PluginCollectionEnumValue = z.infer<typeof enumValue>
export type PluginCollectionField = z.infer<typeof collectionField>
export type PluginCollectionSchema = z.infer<typeof collectionSchema>
export type PluginCollectionParam = z.infer<typeof collectionParam>
export type PluginCollectionCell = z.infer<typeof cellValue>
export type PluginCollectionRowAction = z.infer<typeof collectionRowAction>
/** The tier a row action may declare, and what the host's confirmation is rendered from. */
export type PluginCollectionRowRisk = z.infer<typeof rowRisk>
export type PluginCollectionRowBody = z.infer<typeof collectionRow>
export type PluginCollectionResponse = z.infer<typeof pluginCollectionResponseSchema>

/** A row with its provenance bound by the host. `sourceRowId` appears only on a panel that unioned
 *  several collections: the union qualifies `id` with the source it came from so two providers cannot
 *  collide on `42`, and this is the id the PLUGIN gave the row — what a click hands back to it. */
export type PluginCollectionRow = PluginCollectionRowBody & {
  pluginId: string
  collectionId: string
  sourceRowId?: string
}

/** A parsed answer, every row stamped. What a collection contribution's `fetch` resolves to. */
export type PluginCollectionPage = { schema: PluginCollectionSchema; rows: PluginCollectionRow[] }

/** The manifest half of the param declaration, exported so `contributions.collections` composes the
 *  same schema the response is parsed against rather than a second copy of it (pluginContract.ts). */
export const collectionParamsSchema = z.array(collectionParam).max(MAX_COLLECTION_PARAMS)
