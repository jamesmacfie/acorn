import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extensionPointRegistry, extensionRegistry, type Disposable, type ExtensionContribution } from '@acorn/plugin-api/testkit/client'
import { PREVIEW_TOOLBAR_ACTIONS_POINT, type PreviewToolbarProps } from '../contract/toolbarActions'
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

const node = vi.hoisted(() => ({ id: 'node-a' as string | null }))

const coverPage = (covered: boolean) => page.update?.({ x: 0, y: 0, width: 300, height: 200 }, covered)

vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal,
  activeNodeId: () => node.id,
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

  expect(host.textContent).toContain('Preview works on this computer only')
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

describe('the preview:toolbar-actions point', () => {
  // Compiled contributors, so no worker is involved: the worker path and its checks are client-core's
  // (Slot.test.tsx, RemoteTree.grants.test.tsx). What Preview owns is where they draw, what they are
  // told, and when it agrees to reload.
  type Host = { invoke(name: string, payload?: unknown): Promise<unknown> }
  type Drawn = { pluginId: string; props: PreviewToolbarProps & { host: Host } }
  const drawn: Drawn[] = []
  const registered: Disposable[] = []
  let listen: ReturnType<typeof vi.spyOn>
  let report: (state: object) => void

  const contributor = (pluginId: string) => {
    const registration = extensionRegistry.register({
      id: `plugin:${pluginId}:reload`, pluginId, point: PREVIEW_TOOLBAR_ACTIONS_POINT, label: pluginId, order: 500,
      carrier: 'component',
      component: (props: Drawn['props']) => {
        drawn.push({ pluginId, props })
        return <button type="button" data-contributor={pluginId}>{pluginId}</button>
      },
    } as ExtensionContribution)
    registered.push(registration)
    return registration
  }

  /** A person's press inside one contributor. jsdom dispatches only untrusted events, so this calls the
   *  capturing listener the slot registered on that contributor's element with the browser's bit. */
  const press = (pluginId: string): void => {
    const button = host.querySelector(`[data-contributor="${pluginId}"]`)!
    const index = listen.mock.calls.findIndex(([type]: unknown[], call: number) => type === 'pointerdown'
      && (listen.mock.contexts[call] as Element).tagName === 'SPAN' && (listen.mock.contexts[call] as Element).contains(button))
    ;(listen.mock.calls[index]![1] as EventListener)({ isTrusted: true } as Event)
  }
  const latest = (pluginId: string): Drawn['props'] => drawn.filter((entry) => entry.pluginId === pluginId).at(-1)!.props
  const page = (taskId: string, url: string) => report({ taskId, url, loading: false, canGoBack: true, canGoForward: false })

  const mount = async (taskId = () => 'task-1') => {
    dispose = render(() => <PreviewPane taskId={taskId()} projectId="project-1" url="http://localhost:5173" remoteBlocked={false} />, host)
    report = views.onEvent.mock.calls[0]![0] as unknown as (state: object) => void
    await settled()
  }

  beforeEach(() => {
    drawn.length = 0
    node.id = 'node-a'
    registered.push(extensionPointRegistry.register({
      id: PREVIEW_TOOLBAR_ACTIONS_POINT, ownerId: 'preview', label: 'Preview toolbar', kind: 'remote', mode: 'stack', max: 4,
      actions: ['reload'],
    }))
    listen = vi.spyOn(HTMLElement.prototype, 'addEventListener')
  })
  afterEach(() => {
    listen.mockRestore()
    for (const registration of registered.splice(0).reverse()) registration.dispose()
  })

  it('draws four contributors and a count after Preview’s own controls, with the rectangle below', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) contributor(id)
    await mount()
    page('task-1', 'http://localhost:5173/settings')

    const toolbar = host.querySelector('[role="toolbar"]')!
    const labels = [...toolbar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(labels).toEqual(['Back', 'Forward', 'Reload the page', "Go to the app's start page", 'Copy page address', 'Show developer tools', 'a', 'b', 'c', 'd'])
    expect(toolbar.textContent).toContain('1 more from other plugins')
    expect(toolbar.querySelector('input')?.value).toBe('http://localhost:5173/settings')
    expect(host.querySelector('[data-kind="webview"]')?.hasAttribute('hidden')).toBe(false)
    expect(latest('a')).toEqual(expect.objectContaining({
      taskId: 'task-1', projectId: 'project-1', url: 'http://localhost:5173/settings', loading: false, canGoBack: true, canGoForward: false,
    }))
  })

  it('offers no page until the native view reports one, and refuses a reload with nothing live', async () => {
    contributor('reloader')
    views.ensure.mockImplementation(() => new Promise(() => {}))
    await mount()
    expect(latest('reloader').url).toBeUndefined()
    press('reloader')
    await expect(latest('reloader').host.invoke('reload', { expectedUrl: 'http://localhost:5173' }))
      .resolves.toEqual({ ok: false, reason: 'unsupported' })
    expect(views.command).not.toHaveBeenCalled()
  })

  it('reloads the page on screen through Preview’s own control, and only on a person’s press', async () => {
    contributor('reloader')
    contributor('other')
    await mount()
    page('task-1', 'http://localhost:5173/settings')
    const reloader = latest('reloader').host

    await expect(reloader.invoke('reload', { expectedUrl: 'http://localhost:5173/settings' })).resolves.toEqual({ ok: false, reason: 'needs_person' })
    press('other')
    await expect(reloader.invoke('reload', { expectedUrl: 'http://localhost:5173/settings' })).resolves.toEqual({ ok: false, reason: 'needs_person' })
    press('reloader')
    await expect(reloader.invoke('reload', { expectedUrl: 'http://localhost:5173/' })).resolves.toEqual({ ok: false, reason: 'changed' })
    await expect(reloader.invoke('reload', { expectedUrl: 'http://localhost:5173/settings' })).resolves.toEqual({ ok: true })
    expect(views.command.mock.calls).toEqual([['task-1', 'reload']])
    // No way to ask for navigation: only the declared action reaches Preview.
    await expect(reloader.invoke('load', { url: 'https://example.com' })).rejects.toMatchObject({ code: 'unknown_action' })
    expect(views.load).not.toHaveBeenCalled()
  })

  it('refuses once the page, the Node, or the task changed', async () => {
    contributor('reloader')
    const [taskId, setTaskId] = createSignal('task-1')
    await mount(taskId)
    page('task-1', 'http://localhost:5173/a')
    const mounted = latest('reloader').host
    press('reloader')

    // The person typing in the address box isn't navigation, so the drawn page still stands.
    host.querySelector('input')!.value = 'http://localhost:5173/typed'
    host.querySelector('input')!.dispatchEvent(new Event('input'))
    page('task-1', 'http://localhost:5173/b')
    await expect(mounted.invoke('reload', { expectedUrl: 'http://localhost:5173/a' })).resolves.toEqual({ ok: false, reason: 'changed' })

    node.id = 'node-b'
    await expect(mounted.invoke('reload', { expectedUrl: 'http://localhost:5173/b' })).resolves.toEqual({ ok: false, reason: 'changed' })
    node.id = 'node-a'

    setTaskId('task-2')
    await settled()
    page('task-2', 'http://localhost:5173/b')
    expect(latest('reloader').host).not.toBe(mounted)
    await expect(mounted.invoke('reload', { expectedUrl: 'http://localhost:5173/b' })).resolves.toEqual({ ok: false, reason: 'changed' })
    expect(views.command).not.toHaveBeenCalled()
  })

  it('drops a contributor whose registration goes and keeps Preview’s own Reload', async () => {
    const registration = contributor('reloader')
    await mount()
    expect(host.querySelector('[data-contributor="reloader"]')).not.toBeNull()
    registration.dispose()
    expect(host.querySelector('[data-contributor="reloader"]')).toBeNull()
    host.querySelector<HTMLButtonElement>('button[aria-label="Reload the page"]')!.click()
    expect(views.command).toHaveBeenCalledWith('task-1', 'reload')
  })
})
