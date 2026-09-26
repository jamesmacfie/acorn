import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentSessionDelegation, AgentSessionSnapshot } from '../../contract/wire.ts'

const navigate = vi.fn()
const activate = vi.fn()
const open = vi.fn()
const [nodeId, setNodeId] = createSignal('node-a')
const tasks = [
  { id: 'parent-task', title: 'Main task' },
  { id: 'child-task', title: 'Inspect API' },
]
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: tasks }) }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...await original<Record<string, unknown>>(),
  activateTaskSignals: activate,
  activeNodeId: nodeId,
  pathForTask: (task: { id: string }) => `/tasks/${task.id}`,
  tasksOptions: () => ({}),
}))
vi.mock('./managedSelection', () => ({ openManagedSession: open }))

const [sessions, setSessions] = createSignal<AgentSession[]>([])
const [delegations, setDelegations] = createSignal<Record<string, AgentSessionDelegation>>({})
const [snapshots, setSnapshots] = createSignal<Record<string, AgentSessionSnapshot>>({})
const loadSnapshot = vi.fn(async () => undefined)
vi.mock('./managedStore', () => ({ managedAgentStore: {
  sessions, delegations, snapshots, loadSnapshot,
} }))

const { default: ManagedChildRows } = await import('./ManagedChildRows')
const child = (id: string, overrides: Partial<AgentSession> = {}) => ({
  id, taskId: 'parent-task', title: id, runtimeState: 'working', attention: 'none',
  queuedTurns: 0, archivedAt: null, ...overrides,
}) as AgentSession
const lineage = (id: string, parentSessionId: string): AgentSessionDelegation => ({
  sessionId: id, depth: 1, isolation: 'shared', owner: { kind: 'managed', parentSessionId },
})

const hosts: Array<() => void> = []
afterEach(() => {
  for (const dispose of hosts.splice(0).reverse()) dispose()
  setSessions([])
  setDelegations({})
  setSnapshots({})
  setNodeId('node-a')
  navigate.mockClear()
  activate.mockClear()
  open.mockClear()
  loadSnapshot.mockClear()
})

describe('live delegated child rows', () => {
  it('shows direct children and updates runtime and pending-request attention on the right row', () => {
    setSessions([child('one'), child('two', { taskId: 'child-task' }), child('stranger')])
    setDelegations({ one: lineage('one', 'parent'), two: lineage('two', 'parent'), stranger: lineage('stranger', 'other') })
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <ManagedChildRows parentSessionId="parent" parentTaskId="parent-task" />, host)
    hosts.push(() => { dispose(); host.remove() })

    expect(host.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(host.textContent).toContain('Inspect API')
    expect(host.textContent).not.toContain('stranger')
    setSessions([child('one'), child('two', { taskId: 'child-task', runtimeState: 'waiting', attention: 'permission' }), child('stranger')])
    const rows = host.querySelectorAll('[role="option"]')
    expect(rows[0]?.textContent).toContain('working')
    expect(rows[1]?.textContent).toContain('waiting')
    expect(rows[1]?.textContent).toContain('Wants permission')
    setSnapshots({ two: { requests: [{ kind: 'elicitation', status: 'pending' }] } as AgentSessionSnapshot })
    expect(rows[1]?.textContent).toContain('Wants details filled in')

    // A node switch clears the node-owned roster and lineage; IDs can collide on the next node.
    setSessions([])
    setDelegations({})
    setSnapshots({})
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0)
    setNodeId('node-b')
    setSessions([child('two', { title: 'Other node child', runtimeState: 'waiting', attention: 'permission' })])
    setDelegations({ two: lineage('two', 'parent') })
    expect(host.textContent).toContain('Other node child')
    expect(host.textContent).toContain('Wants permission')
    expect(host.textContent).not.toContain('Inspect API')
    expect(host.querySelector('[role="option"]')?.id).toBe('agents:children:node-b:parent-item-0')
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
  })

  it('opens the child task and managed session and exposes the kit keyboard focus stop', () => {
    setSessions([child('one', { taskId: 'child-task' })])
    setDelegations({ one: lineage('one', 'parent') })
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <ManagedChildRows parentSessionId="parent" parentTaskId="parent-task" />, host)
    hosts.push(() => { dispose(); host.remove() })
    const row = host.querySelector('[role="option"]') as HTMLElement
    row.click()
    expect(activate).toHaveBeenCalledWith(tasks[1], { pane: 'agents' })
    expect(open).toHaveBeenCalledWith('child-task', 'one')
    expect(navigate).toHaveBeenCalledWith('/tasks/child-task')
    row.focus()
    expect(document.activeElement).toBe(row)
    expect(row.tabIndex).toBe(0)
  })
})
