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
  onEvent: vi.fn((_listener: (state: object) => void) => () => {}),
}))

const page = vi.hoisted(() => ({ update: undefined as ((rect: { x: number; y: number; width: number; height: number }, covered: boolean) => void) | undefined }))

const coverPage = (covered: boolean) => page.update?.({ x: 0, y: 0, width: 300, height: 200 }, covered)

vi.mock('@acorn/plugin-api/client', () => ({
  elementRectKey: () => '0:0:300:200',
  previewViews: () => views,
  observeNativePage: (_element: HTMLElement, update: (rect: { x: number; y: number; width: number; height: number }, covered: boolean) => void) => {
    page.update = update
    update({ x: 0, y: 0, width: 300, height: 200 }, false)
    return () => { page.update = undefined }
  },
  visibleElementRect: () => ({ x: 0, y: 0, width: 300, height: 200 }),
}))

let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  views.ensure.mockReset().mockResolvedValue(true)
  document.elementFromPoint = () => host.querySelector('.ui-rect-mount')
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

const settled = async () => { await Promise.resolve(); await Promise.resolve() }

it('restores toolbar state after subscribing without waiting for page navigation', async () => {
  views.ensure.mockImplementation(async () => {
    expect(views.onEvent).toHaveBeenCalledOnce()
    const listener = views.onEvent.mock.calls[0][0] as unknown as (state: object) => void
    listener({ taskId: 'task-1', url: 'http://localhost:5173/settings', loading: false, canGoBack: true, canGoForward: false })
    return true
  })
  dispose = render(() => <PreviewPane taskId="task-1" url="http://localhost:5173" remoteBlocked={false} />, host)
  await settled()
  expect(host.querySelector('input')?.value).toBe('http://localhost:5173/settings')
  expect(host.querySelector('button[aria-label="Back"]')?.hasAttribute('disabled')).toBe(false)
  expect(views.load).not.toHaveBeenCalled()
})

it('does not retry failed ensures during overlay visibility changes and offers an explicit retry', async () => {
  views.ensure.mockResolvedValue(false)
    dispose = render(() => <PreviewPane taskId="task-1" url="http://localhost:5173" remoteBlocked={false} />, host)
    await settled()
    expect(host.textContent).toContain('Could not open the preview')
    coverPage(true)
    coverPage(false)
    expect(views.ensure).toHaveBeenCalledOnce()
    views.ensure.mockResolvedValue(true)
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Retry preview')!.click()
    await settled()
    expect(views.ensure).toHaveBeenCalledTimes(2)
    expect(host.textContent).not.toContain('Could not open the preview')
})

it('hides only the disposed task and rejects a late ensure completion', async () => {
  let finish!: (value: boolean) => void
  views.ensure.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  dispose = render(() => <PreviewPane taskId="task-1" url="http://localhost:5173" remoteBlocked={false} />, host)
  dispose()
  dispose = undefined
  finish(true)
  await settled()
  expect(views.hide).toHaveBeenCalledWith('task-1')
  expect(views.show).not.toHaveBeenCalled()
})

it('does not reconcile a pending or absent URL and retries the same home when it returns', async () => {
  const [url, setUrl] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(true)
  dispose = render(() => <PreviewPane taskId="task-1" url={url()} resolving={pending()} remoteBlocked={false} />, host)
  expect(views.ensure).not.toHaveBeenCalled()
  expect(views.evict).not.toHaveBeenCalled()
  setUrl('http://localhost:5173')
  expect(views.ensure).not.toHaveBeenCalled()
  setPending(false)
  await settled()
  expect(views.ensure).toHaveBeenCalledOnce()
  setUrl(null)
  expect(views.evict).not.toHaveBeenCalled()
  setUrl('http://localhost:5173')
  await settled()
  expect(views.ensure).toHaveBeenCalledTimes(2)
})

it('accepts only the latest target completion when the configured port changes', async () => {
  const completions: ((value: boolean) => void)[] = []
  views.ensure.mockImplementation(() => new Promise((resolve) => completions.push(resolve)))
  const [url, setUrl] = createSignal('http://localhost:5173')
  dispose = render(() => <PreviewPane taskId="task-1" url={url()} remoteBlocked={false} />, host)
  setUrl('http://localhost:5174')
  completions[0](true)
  await settled()
  expect(views.show).not.toHaveBeenCalled()
  completions[1](true)
  await settled()
  expect(views.show).toHaveBeenCalledWith('task-1')
})

it('defers a changed configured home until the overlay uncovers the pane', async () => {
    const [url, setUrl] = createSignal('http://localhost:5173')
    dispose = render(() => <PreviewPane taskId="task-1" url={url()} remoteBlocked={false} />, host)
    await settled()
    coverPage(true)
    setUrl('http://localhost:5174')
    expect(views.ensure).toHaveBeenCalledOnce()
    coverPage(false)
    await settled()
    expect(views.ensure).toHaveBeenCalledTimes(2)
    expect(views.ensure).toHaveBeenLastCalledWith('task-1', 'http://localhost:5174')
})
