import { afterEach, describe, expect, it } from 'vitest'
import type { PanelDefinition } from './model'
import {
  panelRegion,
  panelRegionRegistry,
  regionAllows,
  regionAllowsSource,
  regionHasRoom,
  regionScope,
  regionsToAddTo,
  regionViews,
  sourceRegionOwner,
} from './region'
import {
  adoptUnscopedDashboards,
  emptyDashboards,
  hydrateDashboards,
  panelsAt,
  placementScopeKey,
  placePanel,
  savePanel,
} from './persist'

const panel = (sources: string[], fieldRoles: string[] = [], kind = 'list'): PanelDefinition => ({
  id: 'p1',
  title: 'A panel',
  sources: [],
  shaping: {},
  view: { kind },
  publication: { dashboardId: 'p1', sources, fieldRoles },
})

describe('panel region constraints', () => {
  it('binds default regions to the declaring plugin when source metadata is known', () => {
    const region = panelRegion('tracker', { max: 4 })
    expect(regionAllows(region, panel(['tracker:issues']))).toBe(true)
    expect(regionAllows(region, panel(['github:pulls']))).toBe(false)
    expect(regionViews(region)).toHaveLength(5)
  })

  it('supports explicit sources, field roles, and views', () => {
    expect(
      regionAllows(
        panelRegion('tracker', { sources: ['github:pulls'], views: ['list'], max: 4 }),
        panel(['github:pulls'], ['status']),
      ),
    ).toBe(true)
    expect(
      regionAllows(panelRegion('tracker', { fieldRole: 'status', max: 4 }), panel(['github:pulls'], ['status'])),
    ).toBe(true)
    expect(regionAllows(panelRegion('tracker', { views: ['table'], max: 4 }), panel(['tracker:issues']))).toBe(false)
  })

  it('offers the sources a region would accept', () => {
    expect(regionAllowsSource(panelRegion('tracker', { sources: ['github:pulls'], max: 4 }), 'github:pulls')).toBe(true)
    expect(regionAllowsSource(panelRegion('tracker', { sources: ['github:pulls'], max: 4 }), 'tracker:issues')).toBe(
      false,
    )
    expect(regionAllowsSource(panelRegion('tracker', { fieldRole: 'status', max: 4 }), 'github:pulls')).toBe(true)
    expect(regionAllowsSource(panelRegion('tracker', { max: 4 }), 'tracker:issues')).toBe(true)
    expect(regionAllowsSource(panelRegion('tracker', { max: 4 }), 'github:pulls')).toBe(false)
  })

  it('keeps unavailable source metadata visible and caps placements', () => {
    expect(regionAllows(panelRegion('tracker', { sources: ['gone:away'], max: 2 }), panel([]))).toBe(true)
    expect(regionHasRoom(panelRegion('tracker', { max: 2 }), 1)).toBe(true)
    expect(regionHasRoom(panelRegion('tracker', { max: 2 }), 2)).toBe(false)
    expect(placementScopeKey(regionScope(sourceRegionOwner('tracker', 'issues')))).toBe(
      'plugin-region/tracker%3Aissues',
    )
  })
})

describe('region boards per workspace', () => {
  const registered: { dispose(): void }[] = []
  afterEach(() => {
    for (const entry of registered.splice(0)) entry.dispose()
    hydrateDashboards(emptyDashboards())
  })

  it('keys a region by workspace, so another workspace opens it empty', () => {
    const owner = sourceRegionOwner('tracker', 'issues')
    expect(placementScopeKey(regionScope(owner, 'w1'))).toBe('plugin-region/tracker%3Aissues/w1')
    savePanel(panel(['tracker:issues']))
    placePanel(regionScope(owner, 'w1'), 'p1')
    // What drawing the region in the second workspace does first.
    adoptUnscopedDashboards(regionScope(owner, 'w2'))
    expect(panelsAt(regionScope(owner, 'w2'))).toEqual([])
    expect(panelsAt(regionScope(owner, 'w1')).map((placed) => placed.id)).toEqual(['p1'])
  })

  it('offers the regions that would show a panel, and marks a full one', () => {
    const entry = (id: string, region: ReturnType<typeof panelRegion>, when = true) =>
      registered.push(panelRegionRegistry.register({ id, label: id, region, when: () => when }))
    entry('tracker:issues', panelRegion('tracker', { max: 1 }))
    entry('tracker:tables', panelRegion('tracker', { views: ['table'], max: 4 }))
    entry('tracker:off', panelRegion('tracker', { max: 4 }), false)
    savePanel(panel(['tracker:issues']))
    placePanel(regionScope('tracker:issues', 'w1'), 'p1')

    const metadata = { sources: ['tracker:issues'], fieldRoles: [] }
    expect(regionsToAddTo('w1', 'list', metadata).map(({ label, full }) => ({ label, full }))).toEqual([
      { label: 'tracker:issues', full: true },
    ])
    expect(regionsToAddTo('w2', 'list', metadata).map(({ full }) => full)).toEqual([false])
    expect(regionsToAddTo('w1', 'list', { sources: ['github:pulls'], fieldRoles: [] })).toEqual([])
  })
})
