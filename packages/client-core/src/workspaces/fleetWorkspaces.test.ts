import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import type { Workspace } from '@acorn/protocol/api.ts'
import { activeNodeId, setActiveNode } from '../node/activeNode'
import { refreshFleet, _resetFleet } from '../node/fleet'
import { selectFleetWorkspace, type FleetWorkspace } from './fleetWorkspaces'
import { sourceRegistry } from '../registries/sources'

let routeDisposable: { dispose(): void }

const node = (nodeId: string, label: string): NodeRecord => ({
  nodeId, label, endpoint: `https://127.0.0.1:9${nodeId.length}00`, local: nodeId === 'a',
})

const workspace = (id: string, name: string, repos: { owner: string; name: string }[] = []): Workspace =>
  ({ id, name, color: null, icon: null, sort: 0, repos } as unknown as Workspace)

const entry = (nodeId: string, label: string, ws: Workspace): FleetWorkspace =>
  ({ workspace: ws, nodeId, node: node(nodeId, label) })

beforeEach(async () => {
  routeDisposable = sourceRegistry.register({
    id: 'test.fleet-routes', order: 1, glyph: 'x', label: 'Routes',
    routes: [{ id: 'test.fleet-repo', path: '/:owner/:repo', kind: 'repo', order: 1 }],
  })
  _resetFleet()
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({
        nodes: [node('a', 'Node A'), node('b', 'Node B')],
        statuses: [{ nodeId: 'a', state: 'online' as const }, { nodeId: 'b', state: 'online' as const }],
      }),
      onNodeStatus: () => () => {},
    },
  }
  await refreshFleet()
  setActiveNode('a')
})

afterEach(() => {
  routeDisposable.dispose()
  _resetFleet()
  setActiveNode(null)
  delete (globalThis as { window?: unknown }).window
})

describe('selectFleetWorkspace', () => {
  it('switches the node BEFORE navigating', () => {
    // The order is the whole contract. Routes are `/:owner/:repo` with no node in them, and the shell
    // derives the active workspace from that repo against the ACTIVE node's cache — navigating first
    // would resolve the path against the wrong node, which either finds nothing or finds a different repo
    // that happens to share the owner/name.
    const observed: { path: string; node: string | null }[] = []
    selectFleetWorkspace(
      entry('b', 'Node B', workspace('ws-1', 'Beta', [{ owner: 'acorn', name: 'widget' }])),
      (path) => observed.push({ path, node: activeNodeId() }),
    )
    expect(observed).toEqual([{ path: '/acorn/widget', node: 'b' }])
  })

  it('does not switch nodes for a workspace on the node already active', () => {
    const observed: string[] = []
    selectFleetWorkspace(
      entry('a', 'Node A', workspace('ws-2', 'Alpha', [{ owner: 'acorn', name: 'other' }])),
      (path) => observed.push(path),
    )
    expect(observed).toEqual(['/acorn/other'])
    expect(activeNodeId()).toBe('a')
  })

  it('does nothing for an empty workspace, and does not switch nodes either', () => {
    // An empty workspace has nowhere to go, same as the single-node picker always did. Switching the node
    // anyway would leave the owner looking at another machine for no reason.
    const observed: string[] = []
    selectFleetWorkspace(entry('b', 'Node B', workspace('ws-3', 'Empty')), (path) => observed.push(path))
    expect(observed).toEqual([])
    expect(activeNodeId()).toBe('a')
  })
})
