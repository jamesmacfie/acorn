import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// MCP config files reads a project's files, picked on the page, so it shows the same servers for a
// project whether or not a task is open (docs/mcp.md § Configuration). What is pinned is which project
// the page asks the node about in each case.
const mocks = vi.hoisted(() => ({
  activeTask: null as string | null,
  inspect: vi.fn(async (_projectId: string) => [{ file: '/repo/.mcp.json', servers: [{ name: 'linear', transport: 'stdio', status: 'enabled' }] }]),
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { of: string }) => ({
    data: options().of === 'projects'
      ? [{ id: 'p1', name: 'web', path: '/repo/web' }, { id: 'p2', name: 'api', path: '/repo/api' }]
      : [{ id: 't1', projectId: 'p2' }],
  }),
}))
vi.mock('../../infra/queries', () => ({
  projectsOptions: () => ({ of: 'projects' }),
  tasksOptions: () => ({ of: 'tasks' }),
}))
vi.mock('../tasks/tasks', () => ({ activeTaskId: () => mocks.activeTask }))
vi.mock('./mcpClient', () => ({ mcpApi: { inspect: mocks.inspect, createStarter: vi.fn() } }))

import McpSettings from './McpSettings'

let host: HTMLElement
let dispose: (() => void) | undefined
const mount = () => {
  dispose?.()
  dispose = render(() => <McpSettings />, host)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  mocks.inspect.mockClear()
  mocks.activeTask = null
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

describe('MCP config files', () => {
  it('reads a project with no task open, and the open task’s project when there is one', async () => {
    mount()
    await settle()
    expect(mocks.inspect).toHaveBeenLastCalledWith('p1')
    expect(host.textContent).toContain('linear')

    mocks.activeTask = 't1'
    mount()
    await settle()
    expect(mocks.inspect).toHaveBeenLastCalledWith('p2')
  })
})
