import { describe, expect, it } from 'vitest'
import { addTab, homeTabDomId, renameTab, shiftTab } from './homeTab'
import { emptyDashboards, homeTabs, hydrateDashboards, MAX_TABS, setHomeTabs, dashboards } from './persist'

// The tab bar's arithmetic. The bar itself is not covered here — this suite runs in bare node with no
// Solid plugin, so a green run says nothing about the markup (see the vitest note in the repo docs).

describe('home tab verbs', () => {
  it('names the default tab on the way past when the second dashboard is created', () => {
    const created = addTab([])
    expect(created.tabs[0]).toEqual({ id: '', name: 'Home' })
    expect(created.tabs[1]).toEqual({ id: created.id, name: 'New dashboard' })
    expect(created.id).not.toBe('')
  })

  it('does not hand out a name that is already on the bar', () => {
    const first = addTab([])
    const second = addTab(first.tabs)
    expect(second.tabs.map((tab) => tab.name)).toEqual(['Home', 'New dashboard', 'New dashboard 2'])
  })

  it('renames one tab and reorders by swapping with the neighbour', () => {
    const tabs = [{ id: '', name: 'Home' }, { id: 'a', name: 'Reviews' }, { id: 'b', name: 'Ops' }]
    expect(renameTab(tabs, 'a', 'Triage')[1].name).toBe('Triage')
    expect(shiftTab(tabs, 'b', -1).map((tab) => tab.id)).toEqual(['', 'b', 'a'])
    // Off either end, or a tab that is not there: the list comes back as it went in.
    expect(shiftTab(tabs, '', -1)).toEqual(tabs)
    expect(shiftTab(tabs, 'b', 1)).toEqual(tabs)
    expect(shiftTab(tabs, 'gone', 1)).toEqual(tabs)
  })

  it('survives the cap: every create still produces a distinct name up to the limit', () => {
    let tabs = addTab([]).tabs
    while (tabs.length < MAX_TABS) tabs = addTab(tabs).tabs
    expect(new Set(tabs.map((tab) => tab.name)).size).toBe(MAX_TABS)
  })

  it('writes a list the store and the codec both accept', () => {
    hydrateDashboards(emptyDashboards())
    const created = addTab(homeTabs(dashboards()))
    setHomeTabs(created.tabs)
    // Two dashboards is what makes a bar; the ids round-trip through the codec's own caps.
    expect(homeTabs(dashboards()).map((tab) => tab.id)).toEqual(['', created.id])
    setHomeTabs(renameTab(homeTabs(dashboards()), created.id, 'Reviews'))
    expect(homeTabs(dashboards())[1].name).toBe('Reviews')
    hydrateDashboards(emptyDashboards())
  })

  it('gives the default tab a DOM id, since an empty fragment is not one', () => {
    expect(homeTabDomId('')).toBe('dash-home-tab-default')
    expect(homeTabDomId('a1b2c3d4')).toBe('dash-home-tab-a1b2c3d4')
  })
})
