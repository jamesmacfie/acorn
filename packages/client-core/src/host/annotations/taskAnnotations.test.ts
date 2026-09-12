import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE_TASK_POINT } from '@acorn/protocol/extensionPoints.ts'
import { clearAnnotations } from './annotations'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../registries/extensionPoints/extensionPoints'
import { markersFor } from '../registries/rail/railMarkerFeed'
import { resolveRailMarkers } from '../../features/tabs/railMarkers'
import type { Disposable } from '../../kit/lib/registry'
import { requestTaskAnnotations } from './taskAnnotations'

vi.mock('../plugins/surfaceFailures', () => ({ recordSurfaceFailure: vi.fn() }))

// `core:task` is core's own annotation point, and the thing worth pinning is the translation: a mark
// is a line of text on a diff and a corner icon on a 52-pixel rail row, and the words survive either
// way — in the legend here, beside the icon there. See docs/future/rail-tab.md § Slice 3.

const registered: Disposable[] = []

const contributor = (pluginId: string, marks: { key: { task: string }; severity: 'info' | 'warn' | 'danger'; text: string; icon?: string }[]) => {
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:tasks`,
    pluginId,
    point: CORE_TASK_POINT,
    label: `${pluginId} task marks`,
    order: 500,
    carrier: 'items',
    marks: async () => marks,
  } as ExtensionContribution))
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  clearAnnotations()
})

describe('core:task', () => {
  it('is declared by core, because core has no manifest to declare it in', () => {
    const point = extensionPointRegistry.get(CORE_TASK_POINT)
    expect(point).toMatchObject({ ownerId: 'core', kind: 'annotation', key: ['task'] })
  })

  it('draws a contributor’s mark as a rail marker with the contributor named in the legend', async () => {
    contributor('deploys', [{ key: { task: 't1' }, severity: 'danger', text: 'Staging deploy failed', icon: 'rocket' }])
    requestTaskAnnotations(['t1'])
    await vi.waitFor(() => expect(markersFor({ kind: 'task', id: 't1' })).toHaveLength(1))
    const [marker] = markersFor({ kind: 'task', id: 't1' })
    expect(marker).toMatchObject({ icon: 'rocket', tone: 'danger', label: 'Staging deploy failed — deploys' })
    // Qualified twice over: by this contribution and by the plugin inside it, so two plugins can both
    // send a first mark without colliding.
    expect(marker!.id).toBe('core:task:deploys:0')
    // Clamped into the plugin band, so a mark can never take a corner from a core lifecycle state.
    expect(resolveRailMarkers([...marker ? [marker] : []]).placed[0]!.position).toBe('top-end')
  })

  it('gives a mark with no icon a dot, so nothing a contributor sends is invisible', async () => {
    contributor('incidents', [{ key: { task: 't1' }, severity: 'warn', text: 'Incident open' }])
    requestTaskAnnotations(['t1'])
    await vi.waitFor(() => expect(markersFor({ kind: 'task', id: 't1' })).toHaveLength(1))
    expect(markersFor({ kind: 'task', id: 't1' })[0]).toMatchObject({ dotTone: 'warn' })
    expect(markersFor({ kind: 'task', id: 't1' })[0]!.icon).toBeUndefined()
  })

  it('says nothing about a source or a pane, and nothing about a task nobody marked', async () => {
    contributor('deploys', [{ key: { task: 't1' }, severity: 'info', text: 'Deployed' }])
    requestTaskAnnotations(['t1'])
    await vi.waitFor(() => expect(markersFor({ kind: 'task', id: 't1' })).toHaveLength(1))
    expect(markersFor({ kind: 'task', id: 't2' })).toEqual([])
    expect(markersFor({ kind: 'source', id: 'github' })).toEqual([])
  })
})
