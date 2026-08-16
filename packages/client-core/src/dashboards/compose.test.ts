import { describe, expect, it } from 'vitest'
import type { PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import type { CollectionContribution } from '../registries/collections'
import {
  collectionsForPicker,
  defaultPanelTitle,
  viewForCollection,
  viewsForCollection,
} from './compose'

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

describe('which views a collection may be given', () => {
  it('offers only what the schema can support', () => {
    const withEnum = collection('github', 'pulls-mine', 'My pull requests', {
      fields: [{ id: 'state', name: 'State', type: 'enum', values: [{ id: 'open', label: 'Open' }] }],
    })
    // `board` and `chart` are both gated on an enum field, so the first offers them and the
    // second cannot.
    expect(viewsForCollection(withEnum)).toEqual(['stat', 'list', 'table', 'board', 'chart'])
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
