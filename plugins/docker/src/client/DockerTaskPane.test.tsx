import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/client'
import type { Task } from '@acorn/protocol/api.ts'
const api = vi.hoisted(() => ({ linked: vi.fn() }))
vi.mock('./dockerClient', () => ({ fetchTaskContainers: api.linked }))
vi.mock('./wsChannel', () => ({ wsOnDockerChanged: () => () => {} }))
vi.mock('./ContainerDetail', () => ({ default: (props: { target: string }) => <div>{props.target}</div> }))
import { DockerChips, DockerTaskDetail } from './DockerTaskPane'
const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()); setActiveNode(null); vi.clearAllMocks() })
const mount = () => {
  const host = document.createElement('div'), client = new QueryClient()
  document.body.append(host)
  const task = { id: 'same-task' } as Task
  const stop = render(() => <QueryClientProvider client={client}><DockerChips task={task} /><DockerTaskDetail task={task} /></QueryClientProvider>, host)
  stops.push(() => { stop(); client.clear(); host.remove() })
  return host
}

it('shares one task root across regions and retires held A reads before same-task B mounts', async () => {
  let resolve!: (list: unknown[]) => void
  api.linked.mockReturnValueOnce(new Promise(done => { resolve = done }))
  setActiveNode('a')
  const a = mount()
  expect(api.linked).toHaveBeenCalledTimes(1)
  expect(api.linked).toHaveBeenCalledWith('same-task', 'a')
  setActiveNode('b')
  api.linked.mockResolvedValue([{ id: 'B', name: 'from B', state: 'running' }])
  const b = mount()
  await vi.waitFor(() => expect(b.textContent).toContain('from B'))
  expect(api.linked).toHaveBeenCalledTimes(2)
  expect(api.linked).toHaveBeenLastCalledWith('same-task', 'b')
  resolve([{ id: 'A', name: 'from A', state: 'running' }])
  await Promise.resolve(); await Promise.resolve()
  expect(b.textContent).not.toContain('from A')
  expect(a.textContent).not.toContain('from B')
})
