import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: any[]) => void
  class FakeWebContents {
    listeners = new Map<string, Listener[]>()
    destroyed = false
    url = ''
    session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn() },
    }
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
    loadURL = vi.fn(async (url: string) => { this.url = url })
    close = vi.fn(() => { this.destroyed = true })
    reload = vi.fn()
    stop = vi.fn()
    isDestroyed = () => this.destroyed
    getURL = () => this.url
    isLoading = () => false
    isDevToolsOpened = () => false
    closeDevTools = vi.fn()
    openDevTools = vi.fn()
    setWindowOpenHandler = vi.fn()
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      return this
    }
    emit(event: string, ...args: any[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }
  class FakeWebContentsView {
    static instances: FakeWebContentsView[] = []
    webContents = new FakeWebContents()
    setBounds = vi.fn()
    setVisible = vi.fn()
    constructor(readonly options: { webPreferences?: { partition?: string } }) {
      FakeWebContentsView.instances.push(this)
    }
  }
  return { FakeWebContentsView }
})

vi.mock('electron', () => ({ WebContentsView: electron.FakeWebContentsView }))

const { WebviewService } = await import('./webviewService')

class FakeWindow {
  destroyed = false
  closed: (() => void) | null = null
  webContents = { send: vi.fn() }
  childViews: InstanceType<typeof electron.FakeWebContentsView>[] = []
  contentView = {
    addChildView: vi.fn((view: InstanceType<typeof electron.FakeWebContentsView>) => this.childViews.push(view)),
    removeChildView: vi.fn((view: InstanceType<typeof electron.FakeWebContentsView>) => {
      this.childViews = this.childViews.filter((candidate) => candidate !== view)
    }),
  }
  isDestroyed = () => this.destroyed
  once(event: string, listener: () => void) {
    if (event === 'closed') this.closed = listener
    return this
  }
  close() {
    this.destroyed = true
    this.closed?.()
  }
}

const options = (key: string, owner: FakeWindow, over: Record<string, unknown> = {}) => ({
  key,
  owner: owner as never,
  homeUrl: 'https://docs.example.com/',
  ...over,
})

beforeEach(() => {
  electron.FakeWebContentsView.instances.length = 0
  vi.clearAllMocks()
})

describe('WebviewService', () => {
  it('keeps two keys in one window independent', () => {
    const service = new WebviewService()
    const owner = new FakeWindow()
    service.ensure(options('plugin:a:one', owner))
    service.ensure(options('plugin:a:two', owner))
    const [first, second] = electron.FakeWebContentsView.instances
    expect(owner.childViews).toHaveLength(2)
    expect(service.setBounds(owner as never, 'plugin:a:one', { x: 1, y: 2, width: 300, height: 200 })).toBe(true)
    service.show(owner as never, 'plugin:a:one')
    service.hide(owner as never, 'plugin:a:two')
    expect(first!.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 200 })
    expect(first!.setVisible).toHaveBeenLastCalledWith(true)
    expect(second!.setVisible).toHaveBeenLastCalledWith(false)
  })

  it('refuses a key owned by another window and evicts every owned view on close', () => {
    const service = new WebviewService()
    const owner = new FakeWindow()
    const other = new FakeWindow()
    service.ensure(options('plugin:a:one', owner))
    service.ensure(options('plugin:a:two', owner))
    expect(service.show(other as never, 'plugin:a:one')).toBe(false)
    owner.close()
    expect(owner.childViews).toEqual([])
    expect(electron.FakeWebContentsView.instances.every((view) => view.webContents.destroyed)).toBe(true)
  })

  it('uses distinct ephemeral partitions and makes CDP attachment opt-in', () => {
    const service = new WebviewService()
    const owner = new FakeWindow()
    const attach = vi.fn()
    service.ensure(options('plugin:a:one', owner, { onAttach: attach }))
    service.ensure(options('plugin:a:two', owner))
    const partitions = electron.FakeWebContentsView.instances.map((view) => view.options.webPreferences?.partition)
    expect(new Set(partitions).size).toBe(2)
    expect(partitions.every((partition) => !partition?.startsWith('persist:'))).toBe(true)
    expect(attach).toHaveBeenCalledTimes(1)
  })

  it('cancels and reports a redirect outside the caller policy', () => {
    const service = new WebviewService()
    const owner = new FakeWindow()
    const onBlocked = vi.fn()
    service.ensure(options('plugin:a:docs', owner, {
      allowsNavigation: (url: string) => new URL(url).hostname === 'docs.example.com',
      onBlocked,
    }))
    const preventDefault = vi.fn()
    electron.FakeWebContentsView.instances[0]!.webContents.emit('will-redirect', { preventDefault }, 'https://evil.example/login')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onBlocked).toHaveBeenCalledWith({ key: 'plugin:a:docs', url: 'https://evil.example/login', host: 'evil.example' })
  })
})
