import { describe, expect, it } from 'vitest'
import { dashboardViewKinds as PANEL_VIEW_KINDS } from '@acorn/protocol/dashboardViews.ts'
import type { DashboardDisplaySchema } from './display'
import {
  MAX_PANEL_REFRESH_SECONDS,
  MIN_PANEL_REFRESH_SECONDS,
  panelRefreshSeconds,
  viewSupportedBy,
  viewsForSchema,
} from './model'

const withEnum: DashboardDisplaySchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'status', name: 'Status', type: 'enum', role: 'status' },
  ],
}
const withoutEnum: DashboardDisplaySchema = { fields: [{ id: 'title', name: 'Title', type: 'text' }] }

describe('views are derived from the schema', () => {
  it('offers the three that ask nothing of the fields to any collection, including one with none', () => {
    expect(viewsForSchema(withoutEnum)).toEqual(['stat', 'list', 'table'])
    expect(viewsForSchema({ fields: [] })).toEqual(['stat', 'list', 'table'])
  })

  it('gates board on an enum field, and offers it exactly when the gate passes', () => {
    expect(viewSupportedBy('board', withEnum)).toBe(true)
    expect(viewSupportedBy('board', withoutEnum)).toBe(false)
    expect(viewsForSchema(withEnum)).toEqual(['stat', 'list', 'table', 'board', 'chart'])
    expect(viewsForSchema(withoutEnum)).not.toContain('board')
  })

  it('gates heatmap on two axes', () => {
    const twoAxes = { fields: [...withEnum.fields, { id: 'hour', name: 'Hour', type: 'enum' as const }] }
    expect(viewsForSchema(twoAxes)).toEqual([...PANEL_VIEW_KINDS])
    expect(viewSupportedBy('heatmap', withEnum)).toBe(false)
  })

  it('gates chart on an axis to draw against, which a text-only collection has not got', () => {
    // An enum is a category axis and a datetime is a time axis; numbers alone are values with
    // nowhere to sit (chart.ts § chartShapesFor holds the same predicate, and chart.test.ts pins
    // the two together).
    expect(viewSupportedBy('chart', withEnum)).toBe(true)
    expect(viewSupportedBy('chart', withoutEnum)).toBe(false)
    expect(viewSupportedBy('chart', { fields: [{ id: 'at', name: 'At', type: 'datetime' }] })).toBe(true)
    expect(viewSupportedBy('chart', { fields: [{ id: 'n', name: 'N', type: 'number' }] })).toBe(false)
  })
})

describe('panelRefreshSeconds', () => {
  it("prefers the panel's own choice over the collection's declared hint", () => {
    expect(panelRefreshSeconds(120, 600)).toBe(120)
    expect(panelRefreshSeconds(undefined, 600)).toBe(600)
    expect(panelRefreshSeconds(undefined, undefined)).toBeUndefined()
  })

  it('clamps to the manifest bound rather than trusting a stored number', () => {
    expect(panelRefreshSeconds(1, undefined)).toBe(MIN_PANEL_REFRESH_SECONDS)
    expect(panelRefreshSeconds(10_000_000, undefined)).toBe(MAX_PANEL_REFRESH_SECONDS)
    expect(panelRefreshSeconds(Number.NaN, undefined)).toBeUndefined()
    expect(panelRefreshSeconds(45.6, undefined)).toBe(46)
  })
})
