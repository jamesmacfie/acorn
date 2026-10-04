import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './model'
import { panelRegion, regionAllows, regionAllowsSource, regionHasRoom, regionScope, regionViews, sourceRegionOwner } from './region'
import { placementScopeKey } from './persist'

const panel = (sources: string[], fieldRoles: string[] = [], kind = 'list'): PanelDefinition => ({
  id: 'p1', title: 'A panel', sources: [], shaping: {}, view: { kind },
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
    expect(regionAllows(
      panelRegion('tracker', { sources: ['github:pulls'], views: ['list'], max: 4 }),
      panel(['github:pulls'], ['status']),
    )).toBe(true)
    expect(regionAllows(panelRegion('tracker', { fieldRole: 'status', max: 4 }), panel(['github:pulls'], ['status']))).toBe(true)
    expect(regionAllows(panelRegion('tracker', { views: ['table'], max: 4 }), panel(['tracker:issues']))).toBe(false)
  })

  it('offers the sources a region would accept', () => {
    expect(regionAllowsSource(panelRegion('tracker', { sources: ['github:pulls'], max: 4 }), 'github:pulls')).toBe(true)
    expect(regionAllowsSource(panelRegion('tracker', { sources: ['github:pulls'], max: 4 }), 'tracker:issues')).toBe(false)
    expect(regionAllowsSource(panelRegion('tracker', { fieldRole: 'status', max: 4 }), 'github:pulls')).toBe(true)
    expect(regionAllowsSource(panelRegion('tracker', { max: 4 }), 'tracker:issues')).toBe(true)
    expect(regionAllowsSource(panelRegion('tracker', { max: 4 }), 'github:pulls')).toBe(false)
  })

  it('keeps unavailable source metadata visible and caps placements', () => {
    expect(regionAllows(panelRegion('tracker', { sources: ['gone:away'], max: 2 }), panel([]))).toBe(true)
    expect(regionHasRoom(panelRegion('tracker', { max: 2 }), 1)).toBe(true)
    expect(regionHasRoom(panelRegion('tracker', { max: 2 }), 2)).toBe(false)
    expect(placementScopeKey(regionScope(sourceRegionOwner('tracker', 'issues')))).toBe('plugin-region/tracker%3Aissues')
  })
})
