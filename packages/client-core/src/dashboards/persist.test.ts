import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './model'
import {
  dashboards,
  dashboardsSlice,
  emptyDashboards,
  hydrateDashboards,
  HOME_PLACEMENT,
  panelsAt,
  parseDashboards,
  parsePanelDefinition,
  placePanel,
  placementScopeKey,
  removePanel,
  savePanel,
  unplacePanel,
} from './persist'

const panel = (id: string, over: Partial<PanelDefinition> = {}): PanelDefinition => ({
  id,
  title: `Panel ${id}`,
  queries: [{ pluginId: 'github', collectionId: 'pulls-mine' }],
  shaping: {},
  view: { kind: 'list' },
  ...over,
})

describe('placement scope keys', () => {
  it('spells home as one segment and keeps a composite owner unambiguous', () => {
    expect(placementScopeKey(HOME_PLACEMENT)).toBe('home')
    expect(placementScopeKey({ surface: 'pane', ownerId: 'pr' })).toBe('pane/pr')
    // `pluginId:regionId` is the owner id placements.md names, and it survives the round trip.
    expect(placementScopeKey({ surface: 'plugin-region', ownerId: 'github:sidebar', projectId: 'p1' }))
      .toBe('plugin-region/github%3Asidebar/p1')
    expect(placementScopeKey({ surface: 'pane', ownerId: 'a/b' })).not.toBe(placementScopeKey({ surface: 'pane', ownerId: 'a', projectId: 'b' }))
  })
})

describe('codec', () => {
  it('round-trips a panel through the persisted form', () => {
    const state = {
      panels: {
        p1: panel('p1', {
          shaping: {
            filters: [{ field: 'status', op: 'eq' as const, value: 'ready' }],
            sort: [{ field: 'updated', direction: 'desc' as const }],
            fields: ['title', 'status'],
            limit: 5,
          },
          view: { kind: 'stat', aggregate: 'sum', field: 'size' },
          refresh: 120,
        }),
      },
      placements: { home: ['p1'] },
    }
    expect(parseDashboards(JSON.stringify(dashboardsSlice.codec.serialize(state)))).toEqual(state)
  })

  it('never throws on malformed input and answers with an empty model', () => {
    expect(parseDashboards('{not-json')).toEqual(emptyDashboards())
    expect(parseDashboards(undefined)).toEqual(emptyDashboards())
    expect(parseDashboards('[]')).toEqual(emptyDashboards())
    expect(parseDashboards({ panels: 7, placements: 'nope' })).toEqual(emptyDashboards())
    expect(() => dashboardsSlice.codec.parse('x'.repeat(dashboardsSlice.maxBytes! + 1))).not.toThrow()
  })

  it('drops a panel with no usable query and keeps the rest', () => {
    const parsed = parseDashboards({
      panels: { good: panel('good'), bad: { id: 'bad', queries: [{ pluginId: 'github' }] }, worse: 3 },
      placements: {},
    })
    expect(Object.keys(parsed.panels)).toEqual(['good'])
  })

  it('files a panel under its MAP key, not the id the row claims', () => {
    const parsed = parseDashboards({ panels: { real: panel('impostor') }, placements: {} })
    expect(parsed.panels.real.id).toBe('real')
  })

  it('retains a panel whose collection this build cannot resolve — inert, not dropped', () => {
    // The unknown-ids rule (tasks/layout.ts): persistence asks "is this shaped like a panel?", the
    // registry lookup happens at render. A disabled plugin must not delete somebody's dashboard.
    const parsed = parseDashboards({
      panels: { p1: panel('p1', { queries: [{ pluginId: 'not-installed', collectionId: 'ghosts' }] }) },
      placements: { home: ['p1'], 'pane/unknown-pane': ['p1'], 'plugin-region/gone:region': ['p1'] },
    })
    expect(parsed.panels.p1.queries[0]).toEqual({ pluginId: 'not-installed', collectionId: 'ghosts' })
    expect(parsed.placements).toEqual({ home: ['p1'], 'pane/unknown-pane': ['p1'], 'plugin-region/gone:region': ['p1'] })
  })

  it('retains a placement that references a panel definition it does not have', () => {
    expect(parseDashboards({ panels: {}, placements: { home: ['missing'] } }).placements.home).toEqual(['missing'])
  })

  it('keeps a view kind it cannot draw rather than coercing it', () => {
    // A board written by a newer client must survive a round trip through this one.
    expect(parseDashboards({ panels: { p1: panel('p1', { view: { kind: 'board' } }) }, placements: {} }).panels.p1.view.kind)
      .toBe('board')
  })

  it('round-trips the mapping layer, including the write-back key nothing reads', () => {
    // `writeValue` is the reserved seam (model.ts § PanelMappingColumn): this build never sets it and
    // never looks at it, and it still survives — a reserved shape the codec quietly deletes is not
    // reserved. `bySource` is keyed by `(pluginId, collectionId)`, not by the query's array index.
    const mapping = {
      columns: [{ id: 'c2', label: 'Doing', tone: 'accent' as const }, { id: 'c4', label: 'Done' }],
      bySource: { 'github:pulls-mine': { c2: { values: ['open'] }, c4: { writeValue: 'merged' } } },
      fields: { 'linear:issues-mine': { status: 'state', assignee: '' } },
      unmapped: 'hidden' as const,
    }
    const parsed = parseDashboards({ panels: { p1: panel('p1', { mapping }) }, placements: {} })
    expect(parsed.panels.p1.mapping).toEqual(mapping)
  })

  it('drops the parts of a mapping that name nothing, without losing the rest', () => {
    const parsed = parsePanelDefinition({
      ...panel('p1'),
      mapping: {
        // An id with no label draws a blank heading; a label with no id is unreferenceable.
        columns: [{ id: 'c1', label: 'Todo' }, { id: 'c2' }, 'nope'],
        bySource: { 'github:pulls-mine': { c1: { values: ['open', 7] }, c9: {} }, bad: 3 },
        fields: { 'github:pulls-mine': {} },
        unmapped: 'sideways',
      },
    })
    expect(parsed?.mapping).toEqual({
      columns: [{ id: 'c1', label: 'Todo' }],
      // `c9` had nothing in it; `c1` kept only the strings. An entry naming a column this blob does
      // not carry is retained for the same reason an unknown pane id is — the render side ignores it.
      bySource: { 'github:pulls-mine': { c1: { values: ['open'] } } },
    })
  })

  it('keeps no mapping at all when there is nothing in it', () => {
    expect(parsePanelDefinition({ ...panel('p1'), mapping: {} })?.mapping).toBeUndefined()
    expect(parsePanelDefinition({ ...panel('p1'), mapping: 'nope' })?.mapping).toBeUndefined()
  })

  it('round-trips a panel over two collections', () => {
    const queries = [
      { pluginId: 'github', collectionId: 'pulls-mine' },
      { pluginId: 'linear', collectionId: 'issues-mine' },
    ]
    expect(parsePanelDefinition({ ...panel('p1'), queries })?.queries).toEqual(queries)
  })

  it('discards shaping entries it cannot understand without losing the panel', () => {
    const parsed = parsePanelDefinition({
      ...panel('p1'),
      shaping: { filters: [{ field: 'a', op: 'sideways' }, { field: 'b', op: 'eq', value: 1 }], sort: 'nope', limit: -4 },
    })
    expect(parsed?.shaping).toEqual({ filters: [{ field: 'b', op: 'eq', value: 1 }] })
  })
})

describe('the slice descriptor', () => {
  it('declares the durability the persisted-state machinery needs', () => {
    expect(dashboardsSlice.id).toBe('core.dashboards')
    expect(dashboardsSlice.version).toBe(1)
    expect(dashboardsSlice.unknownIds).toBe('retain-inert')
    expect(dashboardsSlice.scope).toBe('app')
    expect(dashboardsSlice.maxBytes).toBeGreaterThan(0)
  })
})

describe('the store', () => {
  it('places, reorders and unplaces without touching the definitions', () => {
    hydrateDashboards(emptyDashboards())
    savePanel(panel('a'))
    savePanel(panel('b'))
    placePanel(HOME_PLACEMENT, 'a')
    placePanel(HOME_PLACEMENT, 'b')
    expect(panelsAt(HOME_PLACEMENT).map((entry) => entry.id)).toEqual(['a', 'b'])

    placePanel(HOME_PLACEMENT, 'b', 0)
    expect(panelsAt(HOME_PLACEMENT).map((entry) => entry.id)).toEqual(['b', 'a'])

    unplacePanel(HOME_PLACEMENT, 'b')
    expect(panelsAt(HOME_PLACEMENT).map((entry) => entry.id)).toEqual(['a'])
    // Taking a panel off a surface leaves the definition — that is the point of the split.
    expect(dashboards().panels.b).toBeDefined()
  })

  it('skips a placed id with no definition rather than rendering a hole', () => {
    hydrateDashboards({ panels: {}, placements: { home: ['ghost'] } })
    expect(panelsAt(HOME_PLACEMENT)).toEqual([])
  })

  it('removing a panel takes every reference with it', () => {
    hydrateDashboards(emptyDashboards())
    savePanel(panel('a'))
    placePanel(HOME_PLACEMENT, 'a')
    placePanel({ surface: 'pane', ownerId: 'pr' }, 'a')
    removePanel('a')
    expect(dashboards().panels).toEqual({})
    expect(Object.values(dashboards().placements).flat()).toEqual([])
  })
})
