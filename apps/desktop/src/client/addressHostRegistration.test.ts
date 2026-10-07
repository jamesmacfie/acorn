import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  finishes: new Map<string, () => void>(),
  activeNode: 'node-a' as string | null,
}))
vi.mock('@acorn/client-core/host/plugins/reload.ts', () => ({
  preparePluginContributionsForNode: (nodeId: string) => new Promise<void>((resolve) => { state.finishes.set(nodeId, resolve) }),
}))
vi.mock('@acorn/client-core/infra/node/activeNode.ts', () => ({
  activeNodeId: () => state.activeNode,
  setActiveNode: (id: string) => { state.activeNode = id },
}))
vi.mock('@acorn/client-core/infra/node/fleet.ts', () => ({
  homeNodeId: () => 'node-a',
  nodes: () => [{ nodeId: 'node-a' }, { nodeId: 'node-b' }],
}))

import { openLink } from '@acorn/client-core/host/registries/commands'
import { projectSurfaceRegistry } from '@acorn/client-core/host/registries/panes'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { registerAddressHostWhenReady } from './addressHostRegistration'

afterEach(() => {
  state.activeNode = 'node-a'
  state.finishes.clear()
})

it('holds a cold loaded-plugin link until its contribution and Node host register', async () => {
  const navigated: string[] = []
  const sources: (string | null)[] = []
  const stop = registerAddressHostWhenReady({
    nodeId: 'node-a',
    navigate: (path) => navigated.push(path),
    openProject: (path, source) => { navigated.push(path); sources.push(source) },
    openTask: () => false,
    hasProject: () => true,
    loadProjects: async () => {},
    showPromotion: () => {},
  }, (error) => { throw error })
  const link = 'acorn://node-a/p/project/x/loaded/item/42'
  const opening = openLink(link)
  await Promise.resolve()
  expect(navigated).toEqual([])

  const surface = projectSurfaceRegistry.register({
    id: 'loaded-view', path: '/p/:projectId/x/loaded/item/:item', item: 'item', order: 1,
    component: () => null,
  })
  const source = sourceRegistry.register({
    id: 'loaded-source', projectSurfaceId: 'loaded-view', order: 1,
    glyph: 'box', label: 'Loaded',
  })
  try {
    state.finishes.get('node-a')?.()
    expect(await opening).toEqual({ kind: 'opened' })
    expect(navigated).toEqual(['/p/project/x/loaded/item/42'])
    expect(sources).toEqual(['loaded-source'])
  } finally {
    stop()
    source.dispose()
    surface.dispose()
  }
})

it('does not let an old Node contribution pass replace the remounted host', async () => {
  const opened: string[] = []
  const host = (nodeId: string) => ({
    nodeId,
    navigate: () => {},
    openProject: (path: string) => opened.push(`${nodeId}:${path}`),
    openTask: () => false,
    hasProject: () => true,
    loadProjects: async () => {},
    showPromotion: () => {},
  })
  const stopOld = registerAddressHostWhenReady(host('node-a'), (error) => { throw error })
  stopOld()
  const stopNew = registerAddressHostWhenReady(host('node-b'), (error) => { throw error })
  try {
    state.finishes.get('node-b')?.()
    expect(await openLink('acorn://node-b/p/project')).toEqual({ kind: 'opened' })
    state.finishes.get('node-a')?.()
    await Promise.resolve()
    expect(await openLink('acorn://node-b/p/project')).toEqual({ kind: 'opened' })
    expect(opened).toEqual(['node-b:/p/project', 'node-b:/p/project'])
  } finally {
    stopNew()
  }
})
