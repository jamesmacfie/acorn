import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: [{ id: 'task-1', projectId: 'project-1' }] }) }))
vi.mock('@solidjs/router', () => ({ useParams: () => ({ taskId: 'task-1' }), useNavigate: () => vi.fn() }))
vi.mock('@acorn/plugin-api/client', async original => ({ ...await original<Record<string, unknown>>(), onPluginFrame: () => () => {} }))
vi.mock('./memoryClient', async original => ({ ...await original<Record<string, unknown>>(), memoryApi: () => ({ list: mocks.list, get: async (address: unknown) => ({ ...address as object, name: 'deploy', description: 'Deployment rules.', body: 'Deploy through the release pipeline.', type: 'project', hash: 'h', updatedAt: 1 }), history: async () => [], changes: async () => [], preview: async () => ({ text: 'Standing context', counts: { private: 0, project: 0 }, shown: { private: 0, project: 0 }, caps: { private: 4000, project: 12000 } }), sources: async () => [] }) }))
import { MemoryCenterDetail, MemoryList } from './MemoryCenter'
import { selectMemory } from './memorySelection'

let host: HTMLDivElement, dispose: () => void
afterEach(() => { dispose?.(); host?.remove(); selectMemory(undefined); vi.clearAllMocks() })
const mount = () => {
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <><MemoryList /><MemoryCenterDetail /></>, host)
}

it('opens project memory when the rail source is selected from a task URL', async () => {
  mocks.list.mockImplementation(async (projectId?: string) => projectId === 'project-1' ? [{ name: 'deploy', scope: 'project', type: 'project', description: 'Deployment rules.', body: 'Deploy through the release pipeline.', path: '/isolated/deploy.md', updatedAt: 1 }] : [])
  selectMemory({ name: 'deploy', scope: 'project' })
  mount()
  await vi.waitFor(() => expect(host.textContent).toContain('Deploy through the release pipeline.'))
  expect(mocks.list).toHaveBeenCalledWith('project-1')
})

it('shows the overview until a memory is chosen, and the reader after', async () => {
  mocks.list.mockResolvedValue([{ name: 'deploy', scope: 'project', type: 'project', description: 'Deployment rules.', body: '', path: '/isolated/deploy.md', updatedAt: 1 }])
  mount()
  await vi.waitFor(() => expect(host.querySelector('[role="option"], .ui-row')).not.toBeNull())
  expect(host.textContent).toContain('Recent changes')
  ;(host.querySelector('.ui-row') as HTMLElement).click()
  await vi.waitFor(() => expect(host.textContent).toContain('Deploy through the release pipeline.'))
  expect(host.textContent).not.toContain('Recent changes')
})
