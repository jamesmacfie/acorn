import { z } from 'zod'

// ── What a plugin's collection route may answer ────────────────────────────────────────────────────
//
// A collection is a plugin-declared, typed set of records, such as "my open pull requests", that the
// host renders with its own components. What one is, the closed field-type and role vocabularies, the
// caps and the budget argument behind them are all in docs/dashboards.md § Collections.
//
// Declared in the manifest under `contributions.collections`, fetched and parsed by the host, addressed
// everywhere as `(pluginId, collectionId)`.
//
// This is the second descriptor response with a real parser rather than a field-by-field sniff, and it
// is here for the same reason `agentContext.ts` is: a loaded plugin's answer is untrusted wire that the
// host renders under its own chrome. Plain `z.object` throughout, so a plugin answering more has the
// surplus stripped rather than passed through.

/** Enough columns for a wide table. Past this a panel is a spreadsheet, which is a frame's job. */
export const MAX_COLLECTION_FIELDS = 24
/** One page. Panels are glanceable lists, and a host that has to virtualise a plugin's answer has been
 *  handed a database export rather than a collection. */
export const MAX_COLLECTION_ROWS = 500
/** Declared values on one enum field. Past this it is free text wearing a chip. */
export const MAX_COLLECTION_ENUM_VALUES = 32
/** Declared inputs on one collection. A panel editor rendering more than a handful of them is a form. */
export const MAX_COLLECTION_PARAMS = 8
/** One cell. A row is a row, not a document, so a body belongs behind the row's action. */
export const MAX_COLLECTION_CELL_CHARS = 2048

// Semantic rather than primitive. See docs/dashboards.md § The two vocabularies, and the budget.
export const COLLECTION_FIELD_TYPES = ['text', 'number', 'boolean', 'datetime', 'enum', 'person', 'link'] as const

// A second, smaller vocabulary, for cross-source mapping. Optional everywhere, because a field with no
// role is still a perfectly good column. See docs/dashboards.md § The two vocabularies, and the budget.
export const COLLECTION_FIELD_ROLES = ['title', 'status', 'assignee', 'url', 'updated'] as const

// A third closed vocabulary, the views the host draws a collection with. It lives on the wire rather
// than only in the renderer because a manifest names it: a plugin reserving a panel region may narrow
// which views a user may compose there (docs/dashboards.md § Placements). A narrowing that named a kind
// this build has no renderer for would be a constraint nobody can satisfy, so it is an enum and an
// unknown entry is a parse error.
//
// Only the list is here. Which schema supports which view stays in @acorn/dashboards-core, because that
// is a rendering rule derived from the field types above, not a wire format.
export const PANEL_VIEW_KINDS = ['stat', 'list', 'table', 'board', 'chart'] as const
export type PanelViewKind = (typeof PANEL_VIEW_KINDS)[number]

const fieldType = z.enum(COLLECTION_FIELD_TYPES)
const fieldRole = z.enum(COLLECTION_FIELD_ROLES)

// The host's own status vocabulary (client-core/ui/primitives.tsx, `StatusDot`), so a declared value
// lands on a colour the appearance packs already own and a plugin never names one. `mixed` is absent: it
// describes an aggregate of several states, which the host computes rather than a row being one.
const enumValue = z.object({
  // The stable grouping key: what a kanban column is keyed by, and what a value mapping is written
  // against. Stable across refreshes and across workspaces. The label is the part that may vary.
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  tone: z.enum(['ok', 'warn', 'bad', 'muted', 'accent']).optional(),
})

// Display hints hang off the field, never off a panel. Grafana's `FieldConfig` lesson: a unit or a tone
// written on a panel is lost the moment the user switches from a table to a board, and written here it
// survives every view, every placement and every cross-source mapping.
const collectionField = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  type: fieldType,
  role: fieldRole.optional(),
  // `number` only: "MB", "%", "d". Rendered beside the value, never parsed.
  unit: z.string().min(1).max(16).optional(),
  // `enum` only, and optional even there: a query-shaped collection cannot know its values ahead of the
  // data. Absent means the host renders the raw cell and cannot pre-tone or pre-order the groups.
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
  // own fallback for an unusable answer is the same empty page. Two spellings of "nothing" would be one
  // more thing for a panel to branch on and no more information.
  fields: z.array(collectionField).max(MAX_COLLECTION_FIELDS),
})

// Declared inputs the host renders in the panel editor and passes back through opaquely: the plugin owns
// their meaning, Grafana's opaque-target lesson. Not the field vocabulary above, because a param is an
// input rather than a rendered cell and the two sets have no reason to move together. Two forms cover
// every case the two proving providers had.
const collectionParam = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  type: z.enum(['text', 'enum']),
  values: z.array(z.string().min(1).max(64)).max(MAX_COLLECTION_ENUM_VALUES).optional(),
  // `enum` only: several values at once, handed back as one comma-joined string. A second param type
  // would give every reader two enum shapes to branch on. This way a plugin that ignores the flag still
  // receives a string it can read, and the host renders checkboxes instead of a select. The plugin owns
  // what a union of its own values means.
  multiple: z.boolean().optional(),
})

// One scalar per cell. `datetime` is epoch milliseconds, because that is what every other timestamp on
// this wire already is (`updatedAt`, `at`, `fetchedAt`). `null` is "this row has no value here", which is
// a different fact from an empty string and sorts differently.
const cellValue = z.union([z.string().max(MAX_COLLECTION_CELL_CHARS), z.number(), z.boolean(), z.null()])

// Re-spelled rather than imported from pluginContract.ts, which imports this module for its descriptor.
// A value import back would be a module cycle, and a Zod schema built at module scope does not survive
// one. The membership is the manifest's `contextFreeAction` exactly, and collections.test.ts imports both
// types and assigns each to the other, so the day the two drift the build says so.
//
// The risk tier is an additive optional field on the versioned schema. v1 shipped without it and
// therefore shipped no destructive row action at all, because an action that destroys something must not
// exist before arm-to-confirm does. The vocabulary is `ToolRisk` verbatim (api.ts), re-spelled for the
// same module-cycle reason, and held to it by the same test.
//
// Who draws the confirmation, and why a plugin never does, is in docs/dashboards.md § Provenance, and
// what a row may not claim.
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
  // Required, and the one field with no fallback. A mixed board dedupes across refreshes and keys its
  // rendering by this, and write-back would need it later. A row with no stable identity is a row the
  // host cannot tell from a different row that happens to look the same.
  id: z.string().min(1).max(200),
  values: z.record(z.string().min(1).max(64), cellValue)
    .refine((values) => Object.keys(values).length <= MAX_COLLECTION_FIELDS, 'too many values'),
  // The task this row's thing lives in, when it lives in one. It is what makes `openPane` usable from a
  // dashboard: a panel is drawn outside every task, so the verb otherwise has only whichever task the
  // reader happened to have open. See docs/dashboards.md § Provenance, and what a row may not claim.
  //
  // An id no task on this node matches is refused at the click, not rendered as a broken row. The list
  // may simply not have loaded, and a row is worth showing either way.
  taskId: z.string().uuid().optional(),
  action: collectionRowAction.optional(),
})

// Responses carry their schema beside the rows, Grafana's DataFrame move, so the manifest-declared schema
// is the static case and a query-shaped collection declares none and self-describes here.
//
// `pluginId` and `collectionId` are absent from the wire, and the host stamps both from the contribution
// whose route answered. See docs/dashboards.md § Self-describing responses, and the cold case, and
// § Provenance, and what a row may not claim.
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
 *  collide on `42`, and this is the id the plugin gave the row, which is what a click hands back to it. */
export type PluginCollectionRow = PluginCollectionRowBody & {
  pluginId: string
  collectionId: string
  sourceRowId?: string
}

/** A parsed answer, every row stamped. What a collection contribution's `fetch` resolves to. */
export type PluginCollectionPage = { schema: PluginCollectionSchema; rows: PluginCollectionRow[] }

/** The manifest half of the param declaration, exported so `contributions.collections` composes the same
 *  schema the response is parsed against rather than a second copy of it (pluginContract.ts). */
export const collectionParamsSchema = z.array(collectionParam).max(MAX_COLLECTION_PARAMS)
