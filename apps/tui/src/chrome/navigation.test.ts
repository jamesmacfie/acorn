import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task, Workspace } from '@acorn/protocol/api.ts'
import type { CommandExecutionContext, SearchCommand } from '@acorn/client-core/host/registries/commands'
import type { ShellModel } from './model'

// The Go to commands in the terminal: the shared commands
// (client-core/host/registries/commands/navigationCommands.ts) over this shell's model (./navigation.ts).
// The desktop's half is client-core/host/palette/routerNavigation.test.tsx.

const events: string[] = []
vi.mock('@acorn/client-core/infra/node/activeNode.ts', () => ({
  activeNodeId: () => 'node-a',
  setActiveNode: (id: string) => void events.push(`node:${id}`),
}))
vi.mock('@acorn/client-core/infra/node/fleet.ts', () => ({ nodes: () => [{ nodeId: 'node-a', label: 'laptop' }] }))
vi.mock('@acorn/client-core/features/tasks/activate.ts', () => ({
  activateTaskSignals: (task: Task) => void events.push(`activate:${task.id}`),
}))
vi.mock('./routing', () => ({ chooseProject: (id: string) => void events.push(`project:${id}`) }))

const { commandRegistry, registerNavigationCommands } = await import('@acorn/client-core/host/registries/commands')
const { hydrateWorkspaceHistory, workspaceWords } = await import('@acorn/client-core/features/workspaces')
const { shellNavigation } = await import('./navigation')

const task = (id: string, branch: string | null): Task => ({
  id, title: `Task ${id}`, icon: null, origin: 'manual', projectId: 'p1', branch,
  github: null, worktreePath: `/tmp/${id}`, pullNumber: null, status: 'active',
  parentId: null, sort: 0, links: [],
})
const workspace = (id: string, projects: string[]): Workspace => ({
  id, name: `Workspace ${id}`, isDefault: false, sort: 0,
  projects: projects.map((projectId, sort) => ({ id: projectId, name: `Project ${projectId}`, sort })),
})

const workspaces = [workspace('w1', ['p1']), workspace('w2', ['p2'])]
const model = {
  allTasks: () => [task('t1', 'james/one'), task('t2', null)],
  workspaces: () => workspaces,
  workspace: () => workspaces[0],
  chooseWorkspace: (id: string) => void events.push(`workspace:${id}`),
} as Pick<ShellModel, 'allTasks' | 'workspaces' | 'workspace' | 'chooseWorkspace'> as ShellModel

const context: CommandExecutionContext = {
  host: 'tui', nodeId: 'node-a', workspaceId: 'w1', projectId: null, taskId: 't2', paneId: null, surfaceId: null,
}
const search = (id: string) => commandRegistry.get(id) as SearchCommand
const ask = (id: string) => search(id).query('', context, new AbortController().signal)

const register = (mode: 'on' | 'off') => registerNavigationCommands(shellNavigation(model, () => workspaceWords(mode)))
let registered: { dispose(): void } | undefined
afterEach(() => {
  registered?.dispose()
  events.length = 0
})

describe('the Go to commands in the terminal', () => {
  it('lists the node’s tasks by branch, leaves out the open one, and opens the one picked', async () => {
    registered = register('on')
    const rows = await ask('core.goto.task')
    expect(rows).toEqual([{ id: 't1', title: 'Task t1', subtitle: 'james/one', taskId: 't1' }])
    search('core.goto.task').select(rows[0], context)
    expect(events).toEqual(['activate:t1'])
  })

  it('switches to another workspace, leaving out the one on screen', async () => {
    registered = register('on')
    const rows = await ask('core.goto.workspace')
    expect(rows.map((row) => row.id)).toEqual(['w2'])
    search('core.goto.workspace').select(rows[0], context)
    expect(events).toEqual(['workspace:w2'])
  })

  it('goes to a project in another workspace by choosing that workspace first, in project mode', async () => {
    registered = register('off')
    const rows = await ask('core.goto.project')
    expect(rows.map((row) => row.id)).toEqual(['p1', 'p2'])
    search('core.goto.project').select(rows[1], context)
    expect(events).toEqual(['workspace:w2', 'project:p2'])
  })

  it('goes back to the last workspace', () => {
    registered = register('on')
    hydrateWorkspaceHistory({ recent: ['w1', 'w2'] })
    const command = commandRegistry.get('core.goto.workspace-last') as { run: (context: CommandExecutionContext) => unknown }
    command.run(context)
    expect(events).toEqual(['workspace:w2'])
  })
})
