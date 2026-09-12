import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { projectsKey, tasksKey, type Task } from '@acorn/protocol/api.ts'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { Disposable } from '../../kit/lib/registry'

// Go to task, and the one thing about it that is not obvious: the node comes first.
//
// `activateTaskSignals` and the route both resolve against whichever node is active, so activating a
// task that lives on another machine without switching first addresses the wrong one. That order was
// a comment inside a row provider until 2026-09-03 and is now a comment inside a search command; this
// is the test that makes it a fact.
//
// The router is answered rather than mounted, the same way the rail's own test does it, and the fleet
// is answered too: what is under test is the command's decisions, not the fan-out beneath it.

const navigated: string[] = []
vi.mock('@solidjs/router', () => ({
  useNavigate: () => (path: string) => void navigated.push(path),
  useParams: () => ({ projectId: 'p1' }),
}))

const events: string[] = []
vi.mock('../../infra/node/activeNode', () => ({
  activeNodeId: () => 'node-a',
  setActiveNode: (id: string) => void events.push(`node:${id}`),
}))
vi.mock('../../infra/node/fleet', () => ({
  nodes: () => [{ nodeId: 'node-a', label: 'laptop' }, { nodeId: 'node-b', label: 'desktop' }],
}))
vi.mock('../../features/tasks/activate', () => ({
  activateTaskSignals: (task: { id: string }) => void events.push(`activate:${task.id}`),
  pathForTask: (task: { id: string }) => `/t/${task.id}`,
}))
// The fleet fan-out, answering with one remote task on node-b. The hook is a query in real life; here
// it is the shape the command reads.
vi.mock('../../infra/node/fanout', () => ({
  createFleetQuery: () => [() => ({
    rows: [
      { nodeId: 'node-a', node: { label: 'laptop' }, data: [makeTask('t-local', 'Local task')] },
      { nodeId: 'node-b', node: { label: 'desktop' }, data: [makeTask('t-remote', 'Remote task')] },
    ],
  })],
}))

function makeTask(id: string, title: string): Task {
  return {
    id, title, icon: null, origin: 'manual', projectId: 'p1', branch: `james/${id}`,
    github: null, worktreePath: `/tmp/${id}`, pullNumber: null, status: 'active',
    parentId: null, sort: 0, links: [],
  }
}

const { registerNavigationCommands } = await import('./navigationCommands')
const { commandRegistry } = await import('../registries/commands/commands')
type SearchCommand = import('../registries/commands/commands').SearchCommand
type CommandExecutionContext = import('../registries/commands/commands').CommandExecutionContext

const contextFor = (nodeId: string): CommandExecutionContext => ({
  host: 'desktop', nodeId, workspaceId: 'w-1', projectId: 'p1', taskId: null,
  paneId: null, surfaceId: null,
})

let host: HTMLElement
let dispose: (() => void) | undefined
const held: Disposable[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(tasksKey, [makeTask('t-local', 'Local task')])
  client.setQueryData(projectsKey, [
    { id: 'p1', name: 'acorn', color: null, hidden: false },
    { id: 'p2', name: 'hidden one', color: null, hidden: true },
  ])
  const Registrar = () => {
    registerNavigationCommands({ open: () => true, fleetWorkspaces: () => ({ entries: [], grouped: false, unavailable: [] }) })
    return <span />
  }
  dispose = render(() => <QueryClientProvider client={client}><Registrar /></QueryClientProvider>, host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const disposable of held.splice(0).reverse()) disposable.dispose()
  navigated.length = 0
  events.length = 0
})

const search = (id: string): SearchCommand => commandRegistry.get(id) as SearchCommand
const signal = (): AbortSignal => new AbortController().signal
const ask = async (id: string, text: string, nodeId = 'node-a'): Promise<readonly CommandSearchItem[]> =>
  search(id).query(text, contextFor(nodeId), signal())

describe('go to task', () => {
  it('is a fleet search, so the session asks each node for its own rows', async () => {
    expect(search('core.goto.task').scope).toBe('fleet')
    expect((await ask('core.goto.task', '')).map((item) => item.id)).toEqual(['t-local'])
    expect((await ask('core.goto.task', '', 'node-b')).map((item) => item.id)).toEqual(['t-remote'])
  })

  it('switches node before it activates a task that lives on another one', async () => {
    const [item] = await ask('core.goto.task', 'remote', 'node-b')
    search('core.goto.task').select(item, contextFor('node-b'))
    expect(events).toEqual(['node:node-b', 'activate:t-remote'])
    expect(navigated).toEqual(['/t/t-remote'])
  })

  it('switches nothing when the task is already on the active node', async () => {
    const [item] = await ask('core.goto.task', 'local')
    search('core.goto.task').select(item, contextFor('node-a'))
    expect(events).toEqual(['activate:t-local'])
  })

  it('leaves out the task the session opened over, because that is where the reader already is', async () => {
    const command = search('core.goto.task')
    const rows = await command.query('', { ...contextFor('node-a'), taskId: 't-local' }, signal())
    expect(rows).toEqual([])
  })

  it('says so rather than navigating when the task has gone since the list was drawn', async () => {
    const command = search('core.goto.task')
    expect(() => command.select({ id: 'vanished', title: 'Vanished' }, contextFor('node-a')))
      .toThrow('no longer here')
    expect(navigated).toEqual([])
  })
})

describe('go to project', () => {
  it('offers the projects that are not hidden, and navigates to the one that is picked', async () => {
    const rows = await ask('core.goto.project', '')
    expect(rows.map((item) => item.id)).toEqual(['p1'])
    search('core.goto.project').select(rows[0], contextFor('node-a'))
    expect(navigated).toEqual(['/p/p1'])
  })
})

describe('switch node', () => {
  it('offers the other machines, and is not about any one node’s identity', async () => {
    expect(search('core.goto.node').scope).toBe('none')
    const rows = await ask('core.goto.node', '')
    expect(rows.map((item) => item.id)).toEqual(['node-b'])
    search('core.goto.node').select(rows[0], contextFor('node-a'))
    expect(events).toEqual(['node:node-b'])
  })
})
