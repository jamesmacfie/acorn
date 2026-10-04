import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createStore } from 'solid-js/store'

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), params: {} as { projectId?: string; taskId?: string } }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: [{ id: 'task-1', projectId: 'project-1' }] }) }))
vi.mock('@solidjs/router', () => ({ useParams: () => mocks.params, useNavigate: () => vi.fn() }))
vi.mock('@acorn/plugin-api/client', async original => ({ ...await original<Record<string, unknown>>(), onPluginFrame: () => () => {} }))
vi.mock('./memoryClient', async original => ({ ...await original<Record<string, unknown>>(), memoryApi: () => ({ list: mocks.list, get: mocks.get, history: async () => [], changes: async () => [], preview: async () => ({ text: 'Standing context', counts: { private: 0, project: 0 }, shown: { private: 0, project: 0 }, caps: { private: 4000, project: 12000 } }), sources: async () => [] }) }))
import { MemoryCenterDetail, MemoryList } from './MemoryCenter'
import { selectMemory } from './memorySelection'

let host: HTMLDivElement, dispose: () => void
let setParams: (value: { projectId?: string; taskId?: string }) => void
beforeEach(() => {
  const [params, set] = createStore<{ projectId?: string; taskId?: string }>({ taskId: 'task-1' })
  mocks.params = params
  setParams = set
  mocks.get.mockImplementation(async (address) => ({ ...address, description: 'Deployment rules.', body: 'Deploy through the release pipeline.', type: 'project', hash: 'h', updatedAt: 1 }))
})
afterEach(() => { dispose?.(); host?.remove(); selectMemory(undefined); vi.clearAllMocks() })
const mount = () => {
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <><MemoryList /><MemoryCenterDetail /></>, host)
}

it('opens project memory when the rail source is selected from a task URL', async () => {
  mocks.list.mockImplementation(async (projectId?: string) => projectId === 'project-1' ? [{ name: 'deploy', scope: 'project', projectId: 'project-1', type: 'project', description: 'Deployment rules.', body: 'Deploy through the release pipeline.', path: '/isolated/deploy.md', updatedAt: 1 }] : [])
  selectMemory({ name: 'deploy', scope: 'project', projectId: 'project-1' })
  mount()
  await vi.waitFor(() => expect(host.textContent).toContain('Deploy through the release pipeline.'))
  expect(mocks.list).toHaveBeenCalledWith('project-1')
})

it('shows the overview until a memory is chosen, and the reader after', async () => {
  mocks.list.mockResolvedValue([{ name: 'deploy', scope: 'project', projectId: 'project-1', type: 'project', description: 'Deployment rules.', body: '', path: '/isolated/deploy.md', updatedAt: 1 }])
  mount()
  await vi.waitFor(() => expect(host.querySelector('[role="option"], .ui-row')).not.toBeNull())
  expect(host.textContent).toContain('Recent changes')
  ;(host.querySelector('.ui-row') as HTMLElement).click()
  await vi.waitFor(() => expect(host.textContent).toContain('Deploy through the release pipeline.'))
  expect(host.textContent).not.toContain('Recent changes')
})

const row = (name: string, projectId: string | null) => ({ name, projectId, scope: projectId ? 'project' : 'private', type: 'project', description: name, body: '', updatedAt: 1 })

it('shows only the selected project, including while the next project is loading', async () => {
  let finish!: (rows: unknown[]) => void
  mocks.list.mockImplementation((id: string) => id === 'project-2' ? new Promise(resolve => { finish = resolve }) : Promise.resolve([
    row('first-project-rule', 'project-1'), row('other-project-rule', 'project-2'), row('shared-rule', null),
  ]))
  mount()
  await vi.waitFor(() => expect(host.textContent).toContain('first-project-rule'))
  expect(host.textContent).not.toContain('other-project-rule')
  expect(host.textContent).not.toContain('shared-rule')
  expect(host.textContent).not.toContain('All projects')
  setParams({ projectId: 'project-2', taskId: undefined })
  expect(host.textContent).not.toContain('first-project-rule')
  finish([row('second-project-rule', 'project-2')])
  await vi.waitFor(() => expect(host.textContent).toContain('second-project-rule'))
})

it('retires the old reader on a project switch without opening a same-named memory', async () => {
  mocks.list.mockResolvedValue([row('deploy', 'project-1')])
  let finish!: (document: object) => void
  mocks.get.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  selectMemory({ name: 'deploy', scope: 'project', projectId: 'project-1' })
  mount()
  await vi.waitFor(() => expect(mocks.get).toHaveBeenCalled())
  setParams({ projectId: 'project-2', taskId: undefined })
  finish({ name: 'deploy', body: 'First project confidential body.', scope: 'project', projectId: 'project-1', hash: 'h', type: 'project' })
  await vi.waitFor(() => expect(host.textContent).toContain('Recent changes'))
  expect(host.textContent).not.toContain('First project confidential body.')
  expect(mocks.get).toHaveBeenCalledTimes(1)
})

it('requires a selected project instead of falling back to private memories', async () => {
  setParams({ taskId: undefined })
  selectMemory({ name: 'shared-rule', scope: 'private', projectId: null })
  mocks.list.mockResolvedValue([row('shared-rule', null)])
  mount()
  await vi.waitFor(() => expect(host.textContent).toContain('Select a project'))
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.get).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('shared-rule')
})
