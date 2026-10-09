import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { clientEvents, setActiveNode } from '@acorn/plugin-api/client'
import type { DockerContainerDetail } from '../shared/model'

const api = vi.hoisted(() => ({ inspect: vi.fn() }))
vi.mock('./dockerClient', () => ({ fetchContainerDetail: api.inspect }))
vi.mock('./dockerLogStore', () => ({ dockerLogBuffer: () => ({ text: () => 'one\ntwo\nthree', ended: () => false }) }))
vi.mock('./wsChannel', () => ({ wsDockerAttach: () => () => {} }))
vi.mock('./DockerExecTerminal', () => ({ default: () => null }))
vi.mock('@acorn/plugin-api/ui/host', () => ({ Slot: () => null }))
import ContainerDetail from './ContainerDetail'

const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach(stop => stop())
  clientEvents.emit('runtime:task-archived', { taskId: 'detail-navigation' })
  setActiveNode(null)
})
const fixture = (id: string): DockerContainerDetail => ({
  id, name: id, image: 'postgres:17', state: 'running', status: 'Up 2 hours', health: 'healthy',
  command: 'postgres', createdAt: null, startedAt: null, finishedAt: null, exitCode: null,
  restartCount: 0, ports: [], composeProject: null, composeService: null, composeWorkingDir: null,
  labels: {}, env: ['PASSWORD=with=equals'], mounts: [], networks: [], imageId: 'image',
})
const mount = () => {
  const host = document.createElement('div'), client = new QueryClient()
  document.body.append(host)
  const [target, select] = createSignal('first')
  const dispose = render(() => <QueryClientProvider client={client}>
    <ContainerDetail target={target()} taskId="detail-navigation" />
  </QueryClientProvider>, host)
  const stop = () => { dispose(); client.clear(); host.remove() }
  stops.push(stop)
  return { host, select, stop }
}
const click = (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)!
  button.click()
}
const panel = (host: HTMLElement, tab: string) => host.querySelector<HTMLElement>(`#docker-detail-panel-${tab}`)!

it('restores independent container tabs, environment disclosure, and reading places after navigation', async () => {
  setActiveNode('docker-detail-test')
  api.inspect.mockImplementation(async (id: string) => fixture(id))
  const first = mount()
  await vi.waitFor(() => expect(first.host.textContent).toContain('postgres:17'))
  await new Promise(resolve => setTimeout(resolve, 0))
  click(first.host, 'Show variables')
  expect(first.host.textContent).toContain('with=equals')
  panel(first.host, 'info').scrollTop = 220
  panel(first.host, 'info').dispatchEvent(new Event('scroll'))
  click(first.host, 'Logs')
  const follow = first.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  follow.click()
  await new Promise(resolve => setTimeout(resolve, 0))
  const log = first.host.querySelector<HTMLElement>('[role="log"]')!
  log.scrollTop = 340
  log.dispatchEvent(new Event('scroll'))

  first.select('second')
  await vi.waitFor(() => expect(panel(first.host, 'info').hidden).toBe(false))
  expect(first.host.textContent).not.toContain('with=equals')
  first.select('first')
  await vi.waitFor(() => expect(panel(first.host, 'logs').hidden).toBe(false))
  first.stop()

  const returned = mount()
  await vi.waitFor(() => expect(panel(returned.host, 'logs').hidden).toBe(false))
  await vi.waitFor(() => expect(returned.host.querySelector<HTMLElement>('[role="log"]')!.scrollTop).toBe(340))
  expect(returned.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  click(returned.host, 'Info')
  await vi.waitFor(() => expect(panel(returned.host, 'info').scrollTop).toBe(220))
  expect(returned.host.textContent).toContain('with=equals')
})
