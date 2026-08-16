import { describe, expect, it } from 'vitest'
import {
  COLLECTION_FIELD_ROLES,
  COLLECTION_FIELD_TYPES,
  MAX_COLLECTION_FIELDS,
  MAX_COLLECTION_ROWS,
  pluginCollectionResponseSchema,
  type PluginCollectionRowAction,
} from './collections.ts'
import type { PluginCommandAction } from './pluginContract.ts'

// What a loaded plugin's collection route may answer. The vocabularies are the design
// (docs/future/dashboards/data-contract.md), so what is worth pinning is their SIZE and the two rules
// that make a row safe to render beside a stranger's: identity is required, and provenance is absent.

const page = (over: Record<string, unknown> = {}) => pluginCollectionResponseSchema.safeParse({
  schema: { fields: [{ id: 'title', name: 'Title', type: 'text', role: 'title' }] },
  rows: [{ id: 'PR_1', values: { title: 'Fix the checkout' } }],
  ...over,
})

describe('the field vocabulary', () => {
  it('is the seven types and five roles the budget allows, and nothing else', () => {
    // The whole design succeeds or fails on this list staying small. If a type is being added, the
    // question is the one refResolvers.ts asks: every provider's rows get rendered with it forever.
    expect([...COLLECTION_FIELD_TYPES]).toEqual(['text', 'number', 'boolean', 'datetime', 'enum', 'person', 'link'])
    expect([...COLLECTION_FIELD_ROLES]).toEqual(['title', 'status', 'assignee', 'url', 'updated'])
  })

  it('parses a field of every type, with its display hints on the field', () => {
    const result = page({
      schema: {
        fields: [
          { id: 'title', name: 'Title', type: 'text', role: 'title' },
          { id: 'size', name: 'Size', type: 'number', unit: 'MB' },
          { id: 'auto', name: 'Auto-merge', type: 'boolean' },
          { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
          { id: 'status', name: 'Status', type: 'enum', role: 'status', values: [{ id: 'open', label: 'Open', tone: 'accent' }] },
          { id: 'author', name: 'Author', type: 'person', role: 'assignee' },
          { id: 'url', name: 'Link', type: 'link', role: 'url' },
        ],
      },
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.schema.fields[1]?.unit).toBe('MB')
  })

  it('refuses a display hint on a type that cannot render it', () => {
    // The same rule the manifest parser applies one tier up: a declaration that parses and can never do
    // anything is worse than a rejection, because it looks like it worked.
    const field = (over: Record<string, unknown>) =>
      page({ schema: { fields: [{ id: 'f', name: 'F', type: 'text', ...over }] } }).success
    expect(field({ unit: 'MB' })).toBe(false)
    expect(field({ values: [{ id: 'open', label: 'Open' }] })).toBe(false)
    expect(page({ schema: { fields: [{ id: 'f', name: 'F', type: 'number', unit: 'MB' }] } }).success).toBe(true)
  })

  it('refuses a type or a role outside the closed sets', () => {
    expect(page({ schema: { fields: [{ id: 'd', name: 'D', type: 'duration' }] } }).success).toBe(false)
    expect(page({ schema: { fields: [{ id: 'c', name: 'C', type: 'number', role: 'count' }] } }).success).toBe(false)
  })
})

describe('rows', () => {
  it('refuses a row with no stable identity', () => {
    // The one field with no fallback: a mixed board dedupes across refreshes by it and keys rendering
    // on it, so a row without one is a row the host cannot tell from a different row that looks alike.
    expect(page({ rows: [{ values: { title: 'Fix the checkout' } }] }).success).toBe(false)
    expect(page({ rows: [{ id: '', values: {} }] }).success).toBe(false)
  })

  it('strips a row claiming its own provenance rather than passing it through', () => {
    // Plain `z.object`, so surplus is stripped — which means the host's stamp cannot be pre-empted by a
    // body, not merely overwritten by it. A row that could name its own plugin could put its items
    // behind a stranger's badge on a mixed board.
    const result = page({ rows: [{ id: 'x', values: { title: 't' }, pluginId: 'linear', collectionId: 'issues-mine' }] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.rows[0]).toEqual({ id: 'x', values: { title: 't' } })
  })

  it('takes the context-free verbs and refuses the two that need a click site', () => {
    expect(page({ rows: [{ id: 'x', values: {}, action: { verb: 'openUrl', url: 'https://github.test/p/1' } }] }).success).toBe(true)
    expect(page({ rows: [{ id: 'x', values: {}, action: { verb: 'openPane', pane: 'pr' } }] }).success).toBe(true)
    // `createTask` needs a selected rail row and `navigate` a routed project; a panel row has neither.
    expect(page({ rows: [{ id: 'x', values: {}, action: { verb: 'createTask' } }] }).success).toBe(false)
    expect(page({ rows: [{ id: 'x', values: {}, action: { verb: 'navigate', surface: 'linear-issue' } }] }).success).toBe(false)
  })

  it('keeps the row action union identical to the manifest context-free set', () => {
    // collections.ts re-spells `contextFreeAction` rather than importing it, because pluginContract.ts
    // imports this module for its descriptor and a value import back would be a module cycle. These two
    // assignments are the pin: either side gaining or losing a verb stops one of them compiling.
    // The path is nothing but a bounded string at this tier — confinement to the plugin's own
    // namespace is the node's parse-time job, and this package may not spell that prefix at all.
    const fromManifest: PluginCommandAction = { verb: 'runNodeAction', path: '/plugin/board/act' }
    const fromRow: PluginCollectionRowAction = fromManifest
    const backAgain: PluginCommandAction = fromRow
    expect(backAgain).toEqual(fromManifest)
  })
})

describe('the caps', () => {
  it('bounds the columns, the rows and the cells a plugin can hand the host', () => {
    const field = (i: number) => ({ id: `f${i}`, name: `F${i}`, type: 'text' })
    const fields = (count: number) => ({ schema: { fields: Array.from({ length: count }, (_, i) => field(i)) }, rows: [] })
    expect(pluginCollectionResponseSchema.safeParse(fields(MAX_COLLECTION_FIELDS)).success).toBe(true)
    expect(pluginCollectionResponseSchema.safeParse(fields(MAX_COLLECTION_FIELDS + 1)).success).toBe(false)

    const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, values: {} }))
    expect(page({ rows: rows(MAX_COLLECTION_ROWS) }).success).toBe(true)
    expect(page({ rows: rows(MAX_COLLECTION_ROWS + 1) }).success).toBe(false)

    expect(page({ rows: [{ id: 'x', values: { title: 'x'.repeat(2_049) } }] }).success).toBe(false)
    // A cell holds one scalar. A nested object is a document, and a document belongs behind the action.
    expect(page({ rows: [{ id: 'x', values: { title: { text: 'x' } } }] }).success).toBe(false)
  })
})
