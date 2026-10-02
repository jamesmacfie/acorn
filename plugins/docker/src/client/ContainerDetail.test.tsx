import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/client'
const api = vi.hoisted(() => ({ detail: vi.fn(), action: vi.fn(), remove: vi.fn(), refresh: vi.fn(), write: vi.fn(), focus: vi.fn() }))
vi.mock('./dockerClient', () => ({ fetchContainerDetail: api.detail, containerAction: api.action, removeContainer: api.remove }))
vi.mock('./dockerStore', () => ({ refreshDocker: api.refresh }))
vi.mock('./DockerExecTerminal', () => ({ default: () => null }))
vi.mock('@acorn/plugin-api/client', async original => ({ ...await original<Record<string, unknown>>(), writeJson: api.write, requestTerminalFocusIntent: api.focus }))
import ContainerDetail from './ContainerDetail'
Element.prototype.scrollIntoView ??= () => {}
const stops: (() => void)[] = []
beforeEach(() => {
  setActiveNode('a')
  api.detail.mockImplementation(async (id: string) => ({ id, name: id, image: 'fixture', state: 'running', status: 'running', health: null, exitCode: null, command: '', ports: [], mounts: [], networks: [], env: [], restartCount: 0 }))
  api.refresh.mockResolvedValue(undefined)
})
afterEach(() => { stops.splice(0).forEach(stop => stop()); setActiveNode(null); vi.clearAllMocks() })
const mount = () => {
  const [target, setTarget] = createSignal('same')
  const host = document.createElement('div'), client = new QueryClient()
  document.body.append(host)
  const removed = vi.fn()
  const dispose = render(() => <QueryClientProvider client={client}><ContainerDetail target={target()} taskId="task" onRemoved={removed} /></QueryClientProvider>, host)
  stops.push(() => { dispose(); client.clear(); host.remove() })
  return { host, setTarget, removed }
}
const press = (host: HTMLElement, text: string) => {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text)
  expect(button).toBeTruthy()
  button!.click()
}
const held = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

it('keeps a held mutation and its refetch on the original document generation', async () => {
  const pending = held<{ ok: true }>()
  api.action.mockReturnValue(pending.promise)
  const view = mount()
  await vi.waitFor(() => expect(view.host.textContent).toContain('fixture'))
  press(view.host, 'Stop')
  expect(api.action).toHaveBeenCalledWith('same', 'stop', 'a')
  view.setTarget('other'); view.setTarget('same')
  const calls = api.detail.mock.calls.length
  pending.resolve({ ok: true })
  await Promise.resolve(); await Promise.resolve()
  expect(api.detail).toHaveBeenCalledTimes(calls)
  expect(api.refresh).not.toHaveBeenCalled()
})

it('does not focus a held A terminal creation on colliding Node B', async () => {
  const pending = held<{ id: string }>()
  api.write.mockReturnValue(pending.promise)
  const view = mount()
  await vi.waitFor(() => expect(view.host.textContent).toContain('fixture'))
  press(view.host, 'Terminal')
  expect(api.write.mock.calls[0][1]).toMatchObject({ nodeId: 'a' })
  setActiveNode('b')
  pending.resolve({ id: 'same-session' })
  await Promise.resolve(); await Promise.resolve()
  expect(api.focus).not.toHaveBeenCalled()
})
