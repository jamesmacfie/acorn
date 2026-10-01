import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PreviewPane from './PreviewPane'

const views = vi.hoisted(() => ({
  ensure: vi.fn(async () => true),
  setBounds: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  load: vi.fn(),
  command: vi.fn(),
  evict: vi.fn(),
  onEvent: vi.fn(() => () => {}),
}))

vi.mock('@acorn/plugin-api/client', () => ({
  elementRectKey: () => '0:0:300:200',
  previewViews: () => views,
  observeNativePage: (_element: HTMLElement, update: (rect: { x: number; y: number; width: number; height: number }, covered: boolean) => void) => {
    update({ x: 0, y: 0, width: 300, height: 200 }, false)
    return () => {}
  },
  visibleElementRect: () => ({ x: 0, y: 0, width: 300, height: 200 }),
}))

let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

it('shows a remote-node explanation without creating or loading a native view', () => {
  dispose = render(() => <PreviewPane taskId="task-1" url="http://192.168.1.1/admin" remoteBlocked />, host)

  expect(host.textContent).toContain('Preview unavailable on remote Nodes')
  expect(host.querySelector('input')).toBeNull()
  expect(views.ensure).not.toHaveBeenCalled()
  expect(views.load).not.toHaveBeenCalled()
  expect(views.evict).toHaveBeenCalledWith('task-1')
  expect(host.querySelector('[data-kind="webview"]')?.hasAttribute('hidden')).toBe(true)
})

it('evicts a local view and removes its address controls when the active node becomes remote', async () => {
  const [blocked, setBlocked] = createSignal(false)
  dispose = render(() => <PreviewPane taskId="task-1" url="http://localhost:5173/" remoteBlocked={blocked()} />, host)
  expect(views.ensure).toHaveBeenCalledWith('task-1', 'http://localhost:5173/')

  setBlocked(true)
  expect(views.evict).toHaveBeenCalledWith('task-1')
  expect(host.querySelector('input')).toBeNull()
  await Promise.resolve()
  expect(views.evict).toHaveBeenCalledWith('task-1')
  expect(views.show).not.toHaveBeenCalled()
})
