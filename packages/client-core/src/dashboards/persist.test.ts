import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './model'
import {
  dashboards,
  dashboardsSlice,
  emptyDashboards,
  hydrateDashboards,
  HOME_PLACEMENT,
  homeTabIdOf,
  homeTabs,
  homeTabScope,
  layoutAt,
  panelsAt,
  parseDashboards,
  parsePanelDefinition,
  placePanel,
  placementScopeKey,
  removeHomeTab,
  removePanel,
  savePanel,
  setHomeTabs,
  setLayoutAt,
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
      layouts: { home: { p1: { x: 6, y: 2, w: 6, h: 4 } } },
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

  it('round-trips the fields the user invented, and drops one it could not render', () => {
    const parsed = parsePanelDefinition({
      ...panel('p1'),
      mapping: {
        extraFields: [
          { id: 'ref', label: 'Ref', type: 'text' },
          // Every view dispatches on the type, so one this build does not draw is not a field.
          { id: 'weird', label: 'Weird', type: 'duration' },
          { id: 'nameless', type: 'text' },
          'nope',
        ],
        fields: { 'github:pulls-mine': { ref: 'repo' } },
      },
    })
    expect(parsed?.mapping).toEqual({
      extraFields: [{ id: 'ref', label: 'Ref', type: 'text' }],
      fields: { 'github:pulls-mine': { ref: 'repo' } },
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

describe('the geometry codec', () => {
  it('an old blob with no layouts key parses, which is the whole migration', () => {
    const parsed = parseDashboards({ panels: { p1: panel('p1') }, placements: { home: ['p1'] } })
    expect(parsed.layouts).toEqual({})
  })

  it('drops a malformed rect rather than repairing it into place', () => {
    const parsed = parseDashboards({
      panels: {},
      placements: {},
      layouts: { home: { ok: { x: 0, y: 0, w: 6, h: 4 }, partial: { x: 0, y: 0, w: 6 }, junk: 'nope', nan: { x: 0, y: 0, w: NaN, h: 2 } } },
    })
    expect(parsed.layouts.home).toEqual({ ok: { x: 0, y: 0, w: 6, h: 4 } })
  })

  it('clamps a rect into the columns and floors it to whole cells', () => {
    const parsed = parseDashboards({
      panels: {},
      placements: {},
      layouts: { home: { a: { x: 10.6, y: -3, w: 99, h: 2.9 } } },
    })
    // Width loses first, then x follows it: a rect wider than the grid must not be pushed off the
    // left edge to make room for itself.
    expect(parsed.layouts.home.a).toEqual({ x: 0, y: 0, w: 12, h: 2 })
  })

  it('retains a rect for a panel that is not placed in that scope', () => {
    // Same class of thing as an unknown pane id. It costs bytes; dropping it would make a
    // partially-written blob destructive.
    const parsed = parseDashboards({
      panels: { p1: panel('p1') },
      placements: { home: ['p1'] },
      layouts: { home: { p1: { x: 0, y: 0, w: 6, h: 4 }, elsewhere: { x: 6, y: 0, w: 6, h: 4 } } },
    })
    expect(Object.keys(parsed.layouts.home)).toEqual(['p1', 'elsewhere'])
  })

  it('keeps geometry per (scope, panel), so one panel in two places has two rects', () => {
    const parsed = parseDashboards({
      panels: { p1: panel('p1') },
      placements: { home: ['p1'], 'pane/pr': ['p1'] },
      layouts: { home: { p1: { x: 0, y: 0, w: 12, h: 4 } }, 'pane/pr': { p1: { x: 0, y: 0, w: 4, h: 8 } } },
    })
    expect(parsed.layouts.home.p1.w).toBe(12)
    expect(parsed.layouts['pane/pr'].p1.w).toBe(4)
  })
})

describe('the arranged layout', () => {
  it('auto-places every panel of an old blob, in order', () => {
    hydrateDashboards({
      panels: { a: panel('a'), b: panel('b') },
      placements: { home: ['a', 'b'] },
      layouts: {},
    })
    const layout = layoutAt(HOME_PLACEMENT)
    expect(layout.rects.a).toEqual({ x: 0, y: 0, w: 4, h: 4 })
    expect(layout.rects.b).toEqual({ x: 4, y: 0, w: 4, h: 4 })
  })

  it('sizes a panel by its view kind, so a board arrives full width', () => {
    hydrateDashboards({
      panels: { a: panel('a', { view: { kind: 'board' } }) },
      placements: { home: ['a'] },
      layouts: {},
    })
    expect(layoutAt(HOME_PLACEMENT).rects.a).toEqual({ x: 0, y: 0, w: 12, h: 4 })
  })

  it('auto-places only the panel that has no rect', () => {
    hydrateDashboards({
      panels: { a: panel('a'), b: panel('b') },
      placements: { home: ['a', 'b'] },
      layouts: { home: { a: { x: 0, y: 0, w: 8, h: 3 } } },
    })
    const layout = layoutAt(HOME_PLACEMENT)
    expect(layout.rects.a).toEqual({ x: 0, y: 0, w: 8, h: 3 })
    expect(layout.rects.b).toEqual({ x: 8, y: 0, w: 4, h: 4 })
  })

  it('ignores a retained rect whose panel is not placed here', () => {
    hydrateDashboards({
      panels: { a: panel('a') },
      placements: { home: ['a'] },
      layouts: { home: { a: { x: 0, y: 0, w: 4, h: 4 }, ghost: { x: 4, y: 0, w: 8, h: 4 } } },
    })
    expect(Object.keys(layoutAt(HOME_PLACEMENT).rects)).toEqual(['a'])
  })

  it('reading it never rewrites the stored blob', () => {
    const stored = { home: { a: { x: 3, y: 9, w: 4, h: 4 } } }
    hydrateDashboards({ panels: { a: panel('a') }, placements: { home: ['a'] }, layouts: stored })
    // Gravity moved it for the render; nothing was written back. A client that only LOOKS at a board
    // must not be the one that changes it for every other client paired with the node.
    expect(layoutAt(HOME_PLACEMENT).rects.a).toEqual({ x: 3, y: 0, w: 4, h: 4 })
    expect(dashboards().layouts).toEqual(stored)
  })
})

describe('committing a gesture', () => {
  it('writes the rects and rewrites the placement to reading order', () => {
    hydrateDashboards({
      panels: { a: panel('a'), b: panel('b') },
      placements: { home: ['a', 'b'] },
      layouts: {},
    })
    setLayoutAt(HOME_PLACEMENT, {
      order: ['a', 'b'],
      rects: { a: { x: 0, y: 4, w: 6, h: 4 }, b: { x: 0, y: 0, w: 6, h: 4 } },
    })
    // `b` is now the top row, so it is first — which is what an old client with no rects renders,
    // and what a screen reader reads.
    expect(dashboards().placements.home).toEqual(['b', 'a'])
    expect(dashboards().layouts.home.a).toEqual({ x: 0, y: 4, w: 6, h: 4 })
  })

  it('leaves the geometry of every other scope alone', () => {
    hydrateDashboards({
      panels: { a: panel('a') },
      placements: { home: ['a'], 'pane/pr': ['a'] },
      layouts: { 'pane/pr': { a: { x: 0, y: 0, w: 4, h: 8 } } },
    })
    setLayoutAt(HOME_PLACEMENT, { order: ['a'], rects: { a: { x: 6, y: 0, w: 6, h: 2 } } })
    expect(dashboards().layouts['pane/pr'].a).toEqual({ x: 0, y: 0, w: 4, h: 8 })
  })

  it('deleting a panel takes its geometry with it', () => {
    hydrateDashboards({
      panels: { a: panel('a') },
      placements: { home: ['a'] },
      layouts: { home: { a: { x: 0, y: 0, w: 6, h: 4 } } },
    })
    removePanel('a')
    expect(dashboards().layouts.home).toEqual({})
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
    hydrateDashboards({ ...emptyDashboards(), placements: { home: ['ghost'] } })
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

describe('home tabs', () => {
  it('is a placement scope and nothing else — the default tab IS the bare home key', () => {
    expect(placementScopeKey(homeTabScope(''))).toBe('home')
    expect(placementScopeKey(homeTabScope('t1'))).toBe('home/t1')
    expect(homeTabIdOf('home')).toBe('')
    expect(homeTabIdOf('home/t1')).toBe('t1')
    // Not a tab: another surface, and the projectId variant, which no tab carries.
    expect(homeTabIdOf('pane/pr')).toBeUndefined()
    expect(homeTabIdOf('home/t1/p1')).toBeUndefined()
  })

  it('parses tolerantly: keeps the empty id, drops duplicates, caps the count and the name', () => {
    const state = parseDashboards({
      tabs: [
        { id: '', name: '  Home  ' },
        { id: 'a', name: 'Reviews' },
        { id: 'a', name: 'A second Reviews' },
        { id: 'b', name: '' },
        { id: 7, name: 'Not a string id' },
        'nonsense',
        { id: 'long', name: 'x'.repeat(200) },
        ...Array.from({ length: 12 }, (_, index) => ({ id: `fill${index}`, name: `Fill ${index}` })),
      ],
    })
    expect(state.tabs?.map((tab) => tab.id)).toEqual(['', 'a', 'long', 'fill0', 'fill1', 'fill2', 'fill3', 'fill4'])
    expect(state.tabs?.[0].name).toBe('Home')
    expect(state.tabs?.[1].name).toBe('Reviews')
    expect(state.tabs?.[2].name).toHaveLength(60)
  })

  it('leaves the key off entirely when a blob names no tabs, so today\'s Home is untouched', () => {
    expect(parseDashboards({ panels: {}, placements: { home: ['a'] } }).tabs).toBeUndefined()
    expect(homeTabs(parseDashboards({ placements: { home: ['a'], 'home/t1': ['b'] } }))).toEqual([])
  })

  it('recovers a home scope that has panels but no name, so an old client\'s write loses only the name', () => {
    // Exactly what an old client leaves behind: it serialises what it parsed, so `tabs` is gone and
    // every placement survives.
    const state = parseDashboards({
      placements: { home: ['a'], 'home/t1': ['b'], 'home/t2': ['c'], 'pane/pr': ['d'] },
      tabs: [{ id: 't1', name: 'Reviews' }],
    })
    expect(homeTabs(state)).toEqual([
      { id: 't1', name: 'Reviews' },
      { id: '', name: 'Untitled' },
      { id: 't2', name: 'Untitled' },
    ])
  })

  it('always offers the default tab, even with nothing placed on it', () => {
    const state = parseDashboards({ placements: { 'home/t1': ['b'] }, tabs: [{ id: 't1', name: 'Reviews' }] })
    expect(homeTabs(state).map((tab) => tab.id)).toContain('')
  })

  it('round-trips through the slice codec unchanged', () => {
    const state = parseDashboards({ tabs: [{ id: '', name: 'Home' }, { id: 't1', name: 'Reviews' }] })
    expect(parseDashboards(JSON.stringify(dashboardsSlice.codec.serialize(state))).tabs).toEqual(state.tabs)
  })

  it('deleting a tab unplaces it and never touches a definition', () => {
    hydrateDashboards(emptyDashboards())
    savePanel(panel('a'))
    placePanel(HOME_PLACEMENT, 'a')
    placePanel(homeTabScope('t1'), 'a')
    setLayoutAt(homeTabScope('t1'), { order: ['a'], rects: { a: { x: 0, y: 0, w: 4, h: 4 } } })
    setHomeTabs([{ id: '', name: 'Home' }, { id: 't1', name: 'Reviews' }])

    removeHomeTab('t1')
    expect(dashboards().tabs).toEqual([{ id: '', name: 'Home' }])
    expect(dashboards().placements['home/t1']).toBeUndefined()
    expect(dashboards().layouts['home/t1']).toBeUndefined()
    // The definition, and its place on every other surface, survive.
    expect(dashboards().panels.a).toBeDefined()
    expect(panelsAt(HOME_PLACEMENT).map((entry) => entry.id)).toEqual(['a'])
  })

  it('refuses to delete the default tab, which is the bare scope and has no delete', () => {
    hydrateDashboards(emptyDashboards())
    savePanel(panel('a'))
    placePanel(HOME_PLACEMENT, 'a')
    setHomeTabs([{ id: '', name: 'Home' }, { id: 't1', name: 'Reviews' }])
    removeHomeTab('')
    expect(dashboards().tabs).toHaveLength(2)
    expect(panelsAt(HOME_PLACEMENT).map((entry) => entry.id)).toEqual(['a'])
  })

  it('survives a panel deletion — names are not collateral damage of removing a panel', () => {
    hydrateDashboards(emptyDashboards())
    savePanel(panel('a'))
    setHomeTabs([{ id: '', name: 'Home' }, { id: 't1', name: 'Reviews' }])
    removePanel('a')
    expect(dashboards().tabs).toHaveLength(2)
  })
})
