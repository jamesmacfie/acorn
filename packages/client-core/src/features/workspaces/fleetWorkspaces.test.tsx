import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Workspace } from '@acorn/protocol/api.ts'
import { prefsKey, projectsKey, workspacesKey } from '@acorn/protocol/api.ts'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { createFleetQuery, type FleetResult } from '../../infra/node/fanout'
import { createFleetWorkspaces } from './fleetWorkspaces'

vi.mock('../../infra/node/fanout', () => ({ createFleetQuery: vi.fn() }))
vi.mock('../../infra/node/fleet', () => ({ nodes: () => [nodeA, nodeB] }))

const nodeA: NodeRecord = { nodeId: 'a', label: 'Node A', endpoint: 'http://localhost:1', local: true }
const nodeB: NodeRecord = { nodeId: 'b', label: 'Node B', endpoint: 'http://localhost:2', local: false }
const project = (id: string, hidden = false): Project => ({ id, name: id, hidden }) as Project
const workspace = (id: string, projects: Project[]): Workspace => ({
  id,
  name: id,
  isDefault: false,
  sort: 0,
  projects,
})
const row = <T,>(node: NodeRecord, data: T) => ({ nodeId: node.nodeId, node, data, freshness: 'live' as const })
const unavailable = (node: NodeRecord, reason: string) => ({ nodeId: node.nodeId, label: node.label, reason })

let host: HTMLDivElement
let dispose: () => void

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
  vi.mocked(createFleetQuery).mockReset()
})

function mount(
  workspaces: FleetResult<Workspace[]>,
  prefs: FleetResult<Record<string, string>>,
  projects: FleetResult<Project[]>,
) {
  vi.mocked(createFleetQuery).mockImplementation((key) => {
    const query = key(undefined as never)
    const value =
      query === workspacesKey ? workspaces : query === prefsKey ? prefs : query === projectsKey ? projects : undefined
    if (!value) throw new Error(`Unexpected fleet query: ${String(query)}`)
    return [() => value] as never
  })
  dispose = render(() => {
    const list = createFleetWorkspaces()
    return <output>{JSON.stringify(list())}</output>
  }, host)
  return JSON.parse(host.querySelector('output')!.textContent!) as ReturnType<ReturnType<typeof createFleetWorkspaces>>
}

describe('fleet workspace resource', () => {
  it('omits hidden-only rows on an off Node while preserving grouped rows on another Node', () => {
    const hidden = project('hidden', true)
    const visible = project('visible')
    const result = mount(
      {
        rows: [
          row(nodeA, [workspace('hidden-space', [hidden]), workspace('visible-space', [visible])]),
          row(nodeB, [workspace('grouped-space', [hidden])]),
        ],
        unavailable: [],
      },
      { rows: [row(nodeA, { 'core.workspaces': 'off' }), row(nodeB, { 'core.workspaces': 'on' })], unavailable: [] },
      { rows: [row(nodeA, [hidden, visible]), row(nodeB, [hidden])], unavailable: [] },
    )
    expect(result.entries.map(({ nodeId, workspace }) => `${nodeId}:${workspace.id}`)).toEqual([
      'a:visible-space',
      'b:grouped-space',
    ])
    expect(result.unavailable).toEqual([])
    expect(result.grouped).toBe(true)
  })

  it('reports a Node when either required read fails without cache, once if both fail', () => {
    const result = mount(
      {
        rows: [row(nodeA, [workspace('a-space', [project('a')])]), row(nodeB, [workspace('b-space', [project('b')])])],
        unavailable: [],
      },
      { rows: [row(nodeA, { 'core.workspaces': 'off' })], unavailable: [unavailable(nodeB, 'prefs failed')] },
      { rows: [row(nodeA, [project('a')])], unavailable: [unavailable(nodeB, 'projects failed')] },
    )
    expect(result.entries.map(({ nodeId }) => nodeId)).toEqual(['a'])
    expect(result.unavailable).toEqual([unavailable(nodeB, 'prefs failed')])
  })

  it('reports a projects failure even when workspace and preferences reads succeeded', () => {
    const result = mount(
      { rows: [row(nodeB, [workspace('b-space', [project('b')])])], unavailable: [] },
      { rows: [row(nodeB, { 'core.workspaces': 'off' })], unavailable: [] },
      { rows: [], unavailable: [unavailable(nodeB, 'projects failed')] },
    )
    expect(result.entries).toEqual([])
    expect(result.unavailable).toEqual([unavailable(nodeB, 'projects failed')])
  })
})
