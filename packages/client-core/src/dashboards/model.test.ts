import { describe, expect, it } from 'vitest'
import type { PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import {
  MAX_PANEL_REFRESH_SECONDS,
  MIN_PANEL_REFRESH_SECONDS,
  PANEL_VIEW_KINDS,
  isDrawnViewKind,
  panelForCollection,
  panelRefreshSeconds,
  viewSupportedBy,
  viewsForSchema,
} from './model'

const withEnum: PluginCollectionSchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'status', name: 'Status', type: 'enum', role: 'status' },
  ],
}
const withoutEnum: PluginCollectionSchema = { fields: [{ id: 'title', name: 'Title', type: 'text' }] }

describe('views are derived from the schema', () => {
  it('offers the three that ask nothing of the fields to any collection, including one with none', () => {
    expect(viewsForSchema(withoutEnum)).toEqual(['stat', 'list', 'table'])
    expect(viewsForSchema({ fields: [] })).toEqual(['stat', 'list', 'table'])
  })

  it('gates board on an enum field, and offers it exactly when the gate passes', () => {
    expect(viewSupportedBy('board', withEnum)).toBe(true)
    expect(viewSupportedBy('board', withoutEnum)).toBe(false)
    expect(viewsForSchema(withEnum)).toEqual([...PANEL_VIEW_KINDS])
    expect(viewsForSchema(withoutEnum)).not.toContain('board')
    expect(isDrawnViewKind('board')).toBe(true)
    // A kind from a client that draws more than this one. Retained by the codec, inert at render.
    expect(isDrawnViewKind('chart')).toBe(false)
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

describe('panelForCollection', () => {
  it('starts a panel with one query, nothing shaped and a view that needs no column choice', () => {
    const panel = panelForCollection({ pluginId: 'github', collectionId: 'pulls-mine' }, 'My pull requests')
    expect(panel.queries).toHaveLength(1)
    expect(panel.shaping).toEqual({})
    expect(panel.view.kind).toBe('list')
    expect(panel.id).not.toBe(panelForCollection({ pluginId: 'a', collectionId: 'b' }, 'x').id)
  })
})
