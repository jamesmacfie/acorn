import { describe, expect, it } from 'vitest'
import type { PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import type { CollectionContribution } from '../registries/collections'
import type { PanelDefinition } from './model'
import {
  panelRegion,
  regionAdmits,
  regionAllows,
  regionCollections,
  regionHasRoom,
  regionScope,
  regionViews,
  sourceRegionOwner,
} from './region'
import { placementScopeKey } from './persist'

// The constraints a plugin declares over a rectangle it reserved for the user's panels
// (docs/dashboards.md § Placements). Both halves are here — what the editor OFFERS and what the
// host RE-CHECKS at render — because the whole promise is that the two cannot disagree.
//
// The components are not covered: this suite runs in bare node with no Solid plugin, so a green run says
// nothing about the markup.

const collection = (pluginId: string, collectionId: string, schema?: PluginCollectionSchema): CollectionContribution => ({
  id: `${pluginId}:${collectionId}`,
  pluginId,
  collectionId,
  name: collectionId,
  ...(schema ? { schema } : {}),
  fetch: async () => ({ schema: { fields: [] }, rows: [] }),
})

const withStatus: PluginCollectionSchema = { fields: [{ id: 's', name: 'Status', type: 'enum', role: 'status' }] }

const all = [
  collection('tracker', 'issues'),
  collection('tracker', 'boards', withStatus),
  collection('github', 'pulls', withStatus),
  collection('github', 'runs'),
]

const panel = (queries: { pluginId: string; collectionId: string }[], kind = 'list'): PanelDefinition => ({
  id: 'p1',
  title: 'A panel',
  queries,
  shaping: {},
  view: { kind },
})

const lookup = (pluginId: string, collectionId: string) =>
  all.find((entry) => entry.pluginId === pluginId && entry.collectionId === collectionId)

describe('panel region constraints', () => {
  it('defaults to the declaring plugin’s own collections', () => {
    const region = panelRegion('tracker', { max: 4 })
    expect(regionCollections(region, all).map((entry) => entry.id)).toEqual(['tracker:issues', 'tracker:boards'])
    expect(regionViews(region)).toHaveLength(5)
    expect(region.max).toBe(4)
  })

  it('honours an explicit list, including one naming another plugin', () => {
    const region = panelRegion('tracker', { collections: ['github:pulls', 'tracker:issues'], max: 4 })
    expect(regionCollections(region, all).map((entry) => entry.id)).toEqual(['tracker:issues', 'github:pulls'])
    // A reference to something not installed matches nothing rather than erroring — the same outcome as
    // the plugin being disabled, which is the point of not validating it against a registry.
    expect(regionCollections(panelRegion('tracker', { collections: ['gone:away'], max: 4 }), all)).toEqual([])
  })

  it('honours a field-role requirement, and only over a schema it has actually seen', () => {
    const region = panelRegion('tracker', { fieldRole: 'status', max: 4 })
    expect(regionCollections(region, all).map((entry) => entry.id)).toEqual(['tracker:boards', 'github:pulls'])
    // A self-describing collection has no schema until something reads it, so admitting it would be a
    // claim nobody has checked.
    expect(regionAdmits(region, collection('tracker', 'issues'))).toBe(false)
  })

  it('intersects every closed vocabulary with this build’s, never trusting the wire', () => {
    // A newer node naming a view kind and a role this shell has no renderer for.
    const region = panelRegion('tracker', { views: ['table', 'sankey'], fieldRole: 'severity', max: 4 })
    expect(regionViews(region)).toEqual(['table'])
    expect(region.fieldRole).toBeUndefined()
    // …and an allow-list this build understands NONE of falls back to every kind, rather than stranding
    // somebody in front of a picker with no options and no reason.
    expect(regionViews(panelRegion('tracker', { views: ['sankey'], max: 4 }))).toHaveLength(5)
  })

  it('re-checks a composed panel at render time, every query and the view', () => {
    const region = panelRegion('tracker', { views: ['list'], max: 4 })
    const own = panel([{ pluginId: 'tracker', collectionId: 'issues' }])
    expect(regionAllows(region, own, lookup)).toBe(true)
    // One disallowed source is a disallowed panel: the allowance is about what may be SEEN here.
    expect(regionAllows(region, panel([
      { pluginId: 'tracker', collectionId: 'issues' },
      { pluginId: 'github', collectionId: 'runs' },
    ]), lookup)).toBe(false)
    // A view the owner narrowed away, over a collection it allows.
    expect(regionAllows(region, panel([{ pluginId: 'tracker', collectionId: 'issues' }], 'table'), lookup)).toBe(false)
    // An UNRESOLVED collection is admitted and draws inert, so a disabled plugin never looks like a
    // policy refusal.
    expect(regionAllows(region, panel([{ pluginId: 'gone', collectionId: 'away' }]), lookup)).toBe(true)
  })

  it('caps the panel count, and stores under the scope the key format already had', () => {
    const region = panelRegion('tracker', { max: 2 })
    expect(regionHasRoom(region, 1)).toBe(true)
    expect(regionHasRoom(region, 2)).toBe(false)
    // `pluginId:sourceId` contains the separator, which is why the key percent-encodes its segments.
    expect(placementScopeKey(regionScope(sourceRegionOwner('tracker', 'issues')))).toBe('plugin-region/tracker%3Aissues')
  })
})
