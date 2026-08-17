import { describe, expect, it } from 'vitest'
import { MAX_COLLECTION_FIELDS, type PluginCollectionField, type PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import {
  collectionCardMeta,
  defaultFilterFor,
  defaultGroupBy,
  normalizePanel,
  operatorLabel,
  operatorNeedsValue,
  operatorsForField,
  parseLimit,
  parseRefresh,
  retainView,
  retargetFilter,
  schemaOf,
  settleComposition,
  trendsFor,
  viewAvailability,
  viewsFor,
  withOperator,
  withViewKind,
  type PanelComposition,
} from './editor'
import { MAX_PANEL_REFRESH_SECONDS, MIN_PANEL_REFRESH_SECONDS, type PanelDefinition } from './model'
import { parsePanelDefinition } from './persist'

// The generated editor's derivations. The component that composes them cannot be rendered here —
// vitest runs in node with no Solid plugin — so a green suite says nothing about the form. What it
// does say is that the form can only offer valid choices, which is the whole architectural claim.

const schema: PluginCollectionSchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'size', name: 'Size', type: 'number', unit: 'MB' },
    { id: 'status', name: 'Status', type: 'enum', role: 'status', values: [
      { id: 'draft', label: 'Draft', tone: 'muted' },
      { id: 'open', label: 'Open', tone: 'accent' },
    ] },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'flagged', name: 'Flagged', type: 'boolean' },
    { id: 'author', name: 'Author', type: 'person', role: 'assignee' },
    { id: 'url', name: 'Link', type: 'link', role: 'url' },
  ],
}

const field = (id: string): PluginCollectionField => {
  const found = schema.fields.find((entry) => entry.id === id)
  if (!found) throw new Error(`no such field: ${id}`)
  return found
}

const panel = (over: Partial<PanelDefinition> = {}): PanelDefinition => ({
  id: 'p1',
  title: 'Panel',
  queries: [{ pluginId: 'github', collectionId: 'pulls-mine' }],
  shaping: {},
  view: { kind: 'list' },
  ...over,
})

describe('the operator selector offers what the field type can answer', () => {
  it('gives each type its own comparisons, plus emptiness for all of them', () => {
    expect(operatorsForField(field('title'))).toEqual(['contains', 'eq', 'ne', 'is-empty', 'is-not-empty'])
    expect(operatorsForField(field('size'))).toEqual(['eq', 'ne', 'gt', 'lt', 'is-empty', 'is-not-empty'])
    // No `eq` on a datetime: it is an epoch millisecond, and nobody types the same one twice.
    expect(operatorsForField(field('updated'))).toEqual(['gt', 'lt', 'is-empty', 'is-not-empty'])
    expect(operatorsForField(field('status'))).toEqual(['eq', 'ne', 'is-empty', 'is-not-empty'])
    expect(operatorsForField(field('flagged'))).toEqual(['eq', 'is-empty', 'is-not-empty'])
    expect(operatorsForField(field('author'))).toEqual(['eq', 'ne', 'contains', 'is-empty', 'is-not-empty'])
    expect(operatorsForField(field('url'))).toEqual(['contains', 'is-empty', 'is-not-empty'])
  })

  it('offers nothing at all without a field, rather than a list that cannot be applied', () => {
    expect(operatorsForField(undefined)).toEqual([])
  })

  it('reads the relational pair differently over a date than over a number', () => {
    expect(operatorLabel('gt', field('updated'))).toBe('is after')
    expect(operatorLabel('lt', field('updated'))).toBe('is before')
    expect(operatorLabel('gt', field('size'))).toBe('is more than')
    expect(operatorLabel('is-not-empty', field('size'))).toBe('is not empty')
  })

  it('knows which operators are about the cell rather than about a value', () => {
    expect(operatorNeedsValue('is-empty')).toBe(false)
    expect(operatorNeedsValue('is-not-empty')).toBe(false)
    expect(operatorNeedsValue('eq')).toBe(true)
  })
})

describe('a new filter row starts inert', () => {
  it('matches every row until the person says what they meant', () => {
    expect(defaultFilterFor(field('title'))).toEqual({ field: 'title', op: 'contains', value: '' })
    expect(defaultFilterFor(field('size'))).toEqual({ field: 'size', op: 'eq', value: 0 })
    expect(defaultFilterFor(field('updated'))).toEqual({ field: 'updated', op: 'gt', value: 0 })
    expect(defaultFilterFor(field('flagged'))).toEqual({ field: 'flagged', op: 'eq', value: true })
    // The one exception: an enum has no inert value, so its first declared one is the start.
    expect(defaultFilterFor(field('status'))).toEqual({ field: 'status', op: 'eq', value: 'draft' })
  })
})

describe('retargeting and re-operating a filter', () => {
  it('drops an operator the new field cannot answer, and never carries the old value across', () => {
    const text = { field: 'title', op: 'contains' as const, value: 'RAV' }
    expect(retargetFilter(text, field('updated'))).toEqual({ field: 'updated', op: 'gt', value: 0 })
    expect(retargetFilter(text, field('author'))).toEqual({ field: 'author', op: 'contains', value: '' })
  })

  it('gains and loses the value as the operator needs one', () => {
    const filter = { field: 'size', op: 'gt' as const, value: 4 }
    expect(withOperator(filter, field('size'), 'is-empty')).toEqual({ field: 'size', op: 'is-empty' })
    // A value stored under `is-empty` renders nowhere and comes back on the next change, which is
    // how a filter starts meaning something the editor never showed.
    expect(withOperator(filter, field('size'), 'is-empty')).not.toHaveProperty('value')
    expect(withOperator({ field: 'size', op: 'is-empty' }, field('size'), 'lt')).toEqual({ field: 'size', op: 'lt', value: 0 })
  })
})

describe('the view and group-by selectors', () => {
  it('offers board only where there is something with finite values to group by', () => {
    expect(viewsFor({ schema })).toEqual(['stat', 'list', 'table', 'board', 'chart'])
    expect(viewsFor({ schema: { fields: [field('title')] } })).toEqual(['stat', 'list', 'table'])
    // A response-only collection that has never been read promises nothing.
    expect(viewsFor(undefined)).toEqual(['stat', 'list', 'table'])
    expect(schemaOf(undefined).fields).toEqual([])
  })

  it('prefers the ANSWERED schema, which is what unblocks a response-only collection', () => {
    // linear's issues declare no static schema on purpose — only the workspace's own state names are
    // meaningful — so until the last page is read out of the node's cache there is no board and no
    // filter to offer. With it, the editor sees exactly what the panel sees.
    expect(schemaOf(undefined, schema)).toEqual(schema)
    expect(viewsFor(undefined, schema)).toEqual(['stat', 'list', 'table', 'board', 'chart'])
    // An empty answer is not an answer: fall back to whatever was declared.
    expect(schemaOf({ schema }, { fields: [] })).toEqual(schema)
    expect(schemaOf(undefined, { fields: [] }).fields).toEqual([])
  })

  it('preselects the status-role field, which is what the role vocabulary is for', () => {
    expect(defaultGroupBy(schema)).toBe('status')
    expect(defaultGroupBy({ fields: [
      { id: 'kind', name: 'Kind', type: 'enum' },
      { id: 'state', name: 'State', type: 'enum', role: 'status' },
    ] })).toBe('state')
    expect(defaultGroupBy({ fields: [field('title')] })).toBeUndefined()
  })
})

describe('the trend selector', () => {
  it('offers activity only where there is a date to bucket the rows by', () => {
    expect(trendsFor(schema)).toEqual(['activity', 'history'])
    // No datetime: the recorded tier still stands, because it asks nothing of the schema — it asks
    // the node's sampler, and an empty series is a cold state rather than a missing feature.
    expect(trendsFor({ fields: [field('title')] })).toEqual(['history'])
  })

  it('drops an activity trend the schema can no longer draw, and keeps a recorded one', () => {
    const swapped: PluginCollectionSchema = { fields: [field('title')] }
    expect(retainView({ kind: 'stat', trend: 'activity' }, swapped)).toEqual({ kind: 'stat' })
    expect(retainView({ kind: 'stat', trend: 'history' }, swapped)).toEqual({ kind: 'stat', trend: 'history' })
    expect(retainView({ kind: 'stat', trend: 'activity' }, schema)).toEqual({ kind: 'stat', trend: 'activity' })
    // A response-only collection promises no fields, so there is nothing to check against and the
    // person's choice survives — the same escape hatch `retainShaping` takes.
    expect(retainView({ kind: 'stat', trend: 'activity' }, { fields: [] })).toEqual({ kind: 'stat', trend: 'activity' })
  })

  it('carries the three keys through the codec untouched', () => {
    const built = normalizePanel(panel({ view: { kind: 'stat', trend: 'history', compare: 'week', good: 'down' } }), schema)
    expect(parsePanelDefinition(JSON.parse(JSON.stringify(built)))).toEqual(built)
  })
})

describe('the number boxes', () => {
  it('reads an emptied limit as no limit rather than zero rows', () => {
    expect(parseLimit('')).toBeUndefined()
    expect(parseLimit('  ')).toBeUndefined()
    expect(parseLimit('0')).toBe(0)
    expect(parseLimit('12.7')).toBe(12)
    expect(parseLimit('-4')).toBeUndefined()
    expect(parseLimit('nope')).toBeUndefined()
  })

  it("clamps a refresh to the manifest's own bound on the way in", () => {
    expect(parseRefresh('')).toBeUndefined()
    expect(parseRefresh('5')).toBe(MIN_PANEL_REFRESH_SECONDS)
    expect(parseRefresh('99999999')).toBe(MAX_PANEL_REFRESH_SECONDS)
    expect(parseRefresh('120')).toBe(120)
  })
})

describe("the editor's output is a panel the codec hands back unchanged", () => {
  const roundTrip = (value: PanelDefinition) => parsePanelDefinition(JSON.parse(JSON.stringify(value)))

  it('round-trips everything the editor can produce', () => {
    const built = normalizePanel(panel({
      title: '  My pull requests  ',
      queries: [{ pluginId: 'github', collectionId: 'pulls-mine', params: { repo: 'acme/app', empty: '  ' } }],
      shaping: {
        filters: [{ field: 'status', op: 'eq', value: 'open' }],
        sort: [{ field: 'updated', direction: 'desc' }],
        fields: ['status', 'title'],
        groupBy: 'status',
        limit: 20,
      },
      view: { kind: 'board' },
      refresh: 120,
    }), schema)

    expect(built.title).toBe('My pull requests')
    // A param left blank is a param the plugin defaults, not an empty string it has to interpret.
    expect(built.queries[0].params).toEqual({ repo: 'acme/app' })
    expect(roundTrip(built)).toEqual(built)
  })

  it('prunes what the codec would prune, so an untouched panel serializes as an empty shaping', () => {
    const built = normalizePanel(panel({ shaping: { filters: [], sort: [], fields: [] } }), schema)
    expect(built.shaping).toEqual({})
    expect(roundTrip(built)).toEqual(built)
  })

  it('drops shaping that names a field the collection stopped declaring', () => {
    // The case no selector can prevent: valid when it was written, stale after a collection swap.
    const built = normalizePanel(panel({
      shaping: {
        filters: [{ field: 'gone', op: 'eq', value: 'x' }, { field: 'status', op: 'eq', value: 'open' }],
        sort: [{ field: 'gone', direction: 'asc' }],
        fields: ['gone', 'title'],
        groupBy: 'gone',
      },
    }), schema)
    expect(built.shaping).toEqual({
      filters: [{ field: 'status', op: 'eq', value: 'open' }],
      fields: ['title'],
    })
  })

  it('keeps the shaping of a collection that promises no fields at all', () => {
    // Response-only: there is nothing to check against, and deleting a person's filters because the
    // collection self-describes would be the opposite of the rule.
    const shaping = { filters: [{ field: 'anything', op: 'eq' as const, value: 'x' }] }
    expect(normalizePanel(panel({ shaping }), { fields: [] }).shaping).toEqual(shaping)
  })

  it('does not store a projection that names every field in declaration order', () => {
    // Storing it would freeze the column list against a schema that later grows one.
    const all = schema.fields.map((entry) => entry.id)
    expect(normalizePanel(panel({ shaping: { fields: all } }), schema).shaping).toEqual({})
    expect(normalizePanel(panel({ shaping: { fields: [...all].reverse() } }), schema).shaping.fields).toHaveLength(all.length)
  })

  it('normalizes EVERY query, not just the first', () => {
    const built = normalizePanel(panel({
      queries: [
        { pluginId: 'github', collectionId: 'pulls-mine', params: { repo: 'acme/app' } },
        { pluginId: 'linear', collectionId: 'issues-mine', params: { team: '  ' } },
      ],
    }), schema)
    expect(built.queries).toEqual([
      { pluginId: 'github', collectionId: 'pulls-mine', params: { repo: 'acme/app' } },
      { pluginId: 'linear', collectionId: 'issues-mine' },
    ])
  })

  it('drops mapping that names a source the panel no longer has', () => {
    // The mapping's half of the stale sweep: config addressing a collection somebody removed is
    // valid and points at nothing, and it would come back if that source were ever re-added.
    const built = normalizePanel(panel({
      queries: [{ pluginId: 'github', collectionId: 'pulls-mine' }],
      mapping: {
        columns: [{ id: 'c2', label: 'Doing' }],
        bySource: {
          'github:pulls-mine': { c2: { values: ['open'] } },
          'linear:issues-mine': { c2: { values: ['started'] } },
        },
      },
    }), schema)
    expect(built.mapping).toEqual({
      columns: [{ id: 'c2', label: 'Doing' }],
      bySource: { 'github:pulls-mine': { c2: { values: ['open'] } } },
    })
    expect(roundTrip(built)).toEqual(built)
  })
})

describe('view availability', () => {
  const kinds = (schema: PluginCollectionSchema | undefined) =>
    Object.fromEntries(viewAvailability(schema).map((entry) => [entry.kind, entry.reason]))

  it('agrees with viewsForSchema — one set of gates, two presentations', () => {
    for (const candidate of [schema, { fields: [] }, { fields: [schema.fields[0]] }]) {
      expect(viewAvailability(candidate).filter((entry) => entry.ok).map((entry) => entry.kind))
        .toEqual(viewsFor({ schema: candidate }))
    }
  })

  it('names what a warm schema is missing', () => {
    // Text and number only: no enum to make columns from, no enum or date to draw an axis against.
    expect(kinds({ fields: [schema.fields[0], schema.fields[1]] }))
      .toEqual({ stat: 'ok', list: 'ok', table: 'ok', board: 'needs-enum', chart: 'needs-axis' })
  })

  it('says cold rather than impossible when there is no schema at all', () => {
    // A response-only collection nobody has read yet. "This data has no status-like field" would be a
    // claim nobody has checked, so the code says so.
    const cold = { stat: 'ok', list: 'ok', table: 'ok', board: 'cold-schema', chart: 'cold-schema' }
    expect(kinds({ fields: [] })).toEqual(cold)
    expect(kinds(undefined)).toEqual(cold)
  })
})

describe('collection card meta', () => {
  it('prefers the answered schema and reports the cached facts', () => {
    const answered: PluginCollectionSchema = { fields: [{ id: 'x', name: 'X', type: 'text' }] }
    const meta = collectionCardMeta(
      { schema, refresh: 300 },
      { page: { schema: answered, rows: [] }, answeredAt: 1_700_000_000_000 },
    )
    expect(meta.fields).toEqual([{ name: 'X', type: 'text' }])
    expect(meta.refresh).toBe(300)
    expect(meta.rows).toBe(0)
    expect(meta.answeredAt).toBe(1_700_000_000_000)
    expect(meta.selfDescribing).toBe(false)
  })

  it('leaves the cached facts absent rather than reporting a zero nobody measured', () => {
    const meta = collectionCardMeta({ schema })
    expect(meta.rows).toBeUndefined()
    expect(meta.answeredAt).toBeUndefined()
    expect(meta.refresh).toBeUndefined()
    expect(meta.fields.map((field) => field.name)).toEqual(schema.fields.map((field) => field.name))
  })

  it('calls a collection with no declared schema self-describing, answered or not', () => {
    expect(collectionCardMeta(undefined).selfDescribing).toBe(true)
    expect(collectionCardMeta({}, { page: { schema, rows: [] } })).toMatchObject({ selfDescribing: true })
  })

  it('caps the chips at the wire\'s own field limit', () => {
    const wide: PluginCollectionSchema = {
      fields: Array.from({ length: 40 }, (_, index) => ({ id: `f${index}`, name: `F${index}`, type: 'text' as const })),
    }
    expect(collectionCardMeta({ schema: wide }).fields).toHaveLength(MAX_COLLECTION_FIELDS)
  })
})

describe('composition rules', () => {
  const draft = (over: Partial<PanelComposition> = {}): PanelComposition =>
    ({ view: { kind: 'list' }, shaping: {}, ...over })

  it('choosing board chooses a grouping, because a board with none has no columns', () => {
    const next = withViewKind(draft(), 'board', schema)
    expect(next.view.kind).toBe('board')
    expect(next.shaping.groupBy).toBe('status')
  })

  it('leaves a grouping the person already set', () => {
    // `flagged` is groupable but is not the status-role field the default would pick.
    const next = withViewKind(draft({ shaping: { groupBy: 'flagged' } }), 'board', schema)
    expect(next.shaping.groupBy).toBe('flagged')
  })

  it('infers chart axes once, and never over an answer already given', () => {
    const first = withViewKind(draft(), 'chart', schema)
    expect(first.view.shape).toBeDefined()
    const edited = { ...first, view: { ...first.view, x: 'status', shape: 'bar' as const } }
    expect(withViewKind(edited, 'chart', schema).view.x).toBe('status')
  })

  it('re-derives rather than blocks when the schema loses what the view needed', () => {
    // The wizard's "a step whose prerequisites vanished re-derives": the board falls back to a view
    // this schema can draw, and the filter over a field that went with the source goes with it.
    const thin: PluginCollectionSchema = { fields: [{ id: 'title', name: 'Title', type: 'text' }] }
    const next = settleComposition(
      { view: { kind: 'board' }, shaping: { groupBy: 'status', filters: [{ field: 'size', op: 'gt', value: 1 }] } },
      thin,
    )
    expect(next.view.kind).toBe('stat')
    expect(next.shaping.groupBy).toBeUndefined()
    expect(next.shaping.filters).toBeUndefined()
  })

  it('regroups a board whose grouped field went away but whose view still draws', () => {
    const next = settleComposition({ view: { kind: 'board' }, shaping: { groupBy: 'gone' } }, schema)
    expect(next.view.kind).toBe('board')
    expect(next.shaping.groupBy).toBe('status')
  })

  it('leaves a still-valid composition alone', () => {
    const before = { view: { kind: 'board' as const }, shaping: { groupBy: 'status' } }
    expect(settleComposition(before, schema)).toEqual(before)
  })
})
