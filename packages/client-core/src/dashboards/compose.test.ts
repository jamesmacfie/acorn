import { describe, expect, it } from 'vitest'
import type { PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import type { CollectionContribution } from '../registries/collections'
import {
  collectionsForPicker,
  defaultPanelTitle,
  panelMoveTarget,
  viewForCollection,
  viewsForCollection,
} from './compose'
import { emptyDashboards, HOME_PLACEMENT, hydrateDashboards, panelsAt, placePanel, savePanel } from './persist'
import type { PanelDefinition } from './model'

// The chrome's own logic. The components around it cannot be rendered here — vitest runs in node
// with no Solid plugin — so a green suite says nothing about what Home looks like. What it does say
// is that the arithmetic and the derivations behind the menu and the picker are right.

const collection = (pluginId: string, collectionId: string, name: string, schema?: PluginCollectionSchema): CollectionContribution => ({
  id: `${pluginId}:${collectionId}`,
  pluginId,
  collectionId,
  name,
  ...(schema ? { schema } : {}),
  fetch: async () => ({ schema: { fields: [] }, rows: [] }),
})

const panel = (id: string): PanelDefinition => ({
  id,
  title: id,
  queries: [{ pluginId: 'github', collectionId: 'pulls-mine' }],
  shaping: {},
  view: { kind: 'list' },
})

describe('which views a collection may be given', () => {
  it('offers only what the schema can support', () => {
    const withEnum = collection('github', 'pulls-mine', 'My pull requests', {
      fields: [{ id: 'state', name: 'State', type: 'enum', values: [{ id: 'open', label: 'Open' }] }],
    })
    // `board` is gated on an enum field, so the first offers it and the second cannot.
    expect(viewsForCollection(withEnum)).toEqual(['stat', 'list', 'table', 'board'])
    expect(viewsForCollection(collection('x', 'y', 'Y', { fields: [] }))).toEqual(['stat', 'list', 'table'])
  })

  it('treats a collection with no declared schema as one with no fields', () => {
    // Response-only: nothing can be promised before the first read, so only the views that ask
    // nothing of the fields are on the table.
    expect(viewsForCollection(collection('x', 'y', 'Y'))).toEqual(['stat', 'list', 'table'])
  })

  it('keeps the chosen view across a collection swap when the new one supports it', () => {
    const entry = collection('x', 'y', 'Y')
    expect(viewForCollection(entry, 'table')).toBe('table')
    expect(viewForCollection(entry, undefined)).toBe('stat')
    // `board` needs an enum field, and this collection promises no fields at all.
    expect(viewForCollection(entry, 'board')).toBe('stat')
  })
})

describe('the collection picker', () => {
  const entries = [
    collection('linear', 'issues-mine', 'Issues'),
    collection('github', 'pulls-mine', 'My pull requests'),
    collection('github', 'issues-mine', 'Issues'),
  ]

  it('orders by plugin then name, so the flat list reads as grouped', () => {
    expect(collectionsForPicker(entries).map((entry) => entry.id))
      .toEqual(['github:issues-mine', 'github:pulls-mine', 'linear:issues-mine'])
  })

  it('filters on the name, the plugin and the collection id', () => {
    expect(collectionsForPicker(entries, 'linear').map((entry) => entry.id)).toEqual(['linear:issues-mine'])
    expect(collectionsForPicker(entries, 'PULLS').map((entry) => entry.id)).toEqual(['github:pulls-mine'])
    expect(collectionsForPicker(entries, 'issues').map((entry) => entry.id))
      .toEqual(['github:issues-mine', 'linear:issues-mine'])
    expect(collectionsForPicker(entries, '   ')).toHaveLength(3)
    expect(collectionsForPicker(entries, 'nothing')).toEqual([])
  })

  it('qualifies a default title only when another collection answers to the same name', () => {
    expect(defaultPanelTitle(entries[1], entries)).toBe('My pull requests')
    expect(defaultPanelTitle(entries[0], entries)).toBe('Issues (linear)')
    expect(defaultPanelTitle(entries[2], entries)).toBe('Issues (github)')
    // A collection is never ambiguous with itself.
    expect(defaultPanelTitle(entries[0], [entries[0]])).toBe('Issues')
  })
})

describe('reorder', () => {
  it('refuses the move that would do nothing', () => {
    expect(panelMoveTarget(0, -1, 3)).toBeUndefined()
    expect(panelMoveTarget(2, 1, 3)).toBeUndefined()
    expect(panelMoveTarget(0, -1, 1)).toBeUndefined()
    expect(panelMoveTarget(0, 1, 1)).toBeUndefined()
    // An index the list does not have: a stale menu against a placement something else changed.
    expect(panelMoveTarget(3, -1, 3)).toBeUndefined()
    expect(panelMoveTarget(-1, 1, 3)).toBeUndefined()
    expect(panelMoveTarget(0, 1, 0)).toBeUndefined()
  })

  it('is a swap with the neighbour in both directions', () => {
    expect(panelMoveTarget(1, -1, 3)).toBe(0)
    expect(panelMoveTarget(1, 1, 3)).toBe(2)
  })

  it('lands where it says it will once placePanel has removed and reinserted', () => {
    // The end-to-end check the arithmetic exists for: placePanel takes the panel OUT before
    // inserting, so a downward target computed against the original list is off by one unless it is
    // exactly `index + 1`. Both directions, and both ends.
    hydrateDashboards(emptyDashboards())
    for (const id of ['a', 'b', 'c']) {
      savePanel(panel(id))
      placePanel(HOME_PLACEMENT, id)
    }
    const order = () => panelsAt(HOME_PLACEMENT).map((entry) => entry.id)
    expect(order()).toEqual(['a', 'b', 'c'])

    placePanel(HOME_PLACEMENT, 'b', panelMoveTarget(1, 1, 3)!)
    expect(order()).toEqual(['a', 'c', 'b'])

    placePanel(HOME_PLACEMENT, 'b', panelMoveTarget(2, -1, 3)!)
    expect(order()).toEqual(['a', 'b', 'c'])

    placePanel(HOME_PLACEMENT, 'a', panelMoveTarget(0, 1, 3)!)
    expect(order()).toEqual(['b', 'a', 'c'])

    placePanel(HOME_PLACEMENT, 'c', panelMoveTarget(2, -1, 3)!)
    expect(order()).toEqual(['b', 'c', 'a'])
  })
})
