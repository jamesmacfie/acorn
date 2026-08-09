import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: any[]) => unknown
  class FakeSession {
    beforeSendHeaders: ((details: { url: string; requestHeaders: Record<string, string> }, callback: (result: { requestHeaders: Record<string, string> }) => void) => void) | null = null
    setPermissionRequestHandler = vi.fn()
    setPermissionCheckHandler = vi.fn()
    webRequest = { onBeforeSendHeaders: vi.fn((handler: FakeSession['beforeSendHeaders']) => { this.beforeSendHeaders = handler }) }
  }
  class FakeWebContents {
    listeners = new Map<string, Listener[]>()
    session = new FakeSession()
    destroyed = false
    url = ''
    loadURL = vi.fn(async (url: string) => { this.url = url })
    close = vi.fn(() => { this.destroyed = true })
    reload = vi.fn()
    stop = vi.fn()
    closeDevTools = vi.fn()
    openDevTools = vi.fn()
    getURL = () => this.url
    isDestroyed = () => this.destroyed
    isLoading = () => false
    isDevToolsOpened = () => false
    setWindowOpenHandler = vi.fn()
    executeJavaScript = vi.fn(async () => true)
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      return this
    }
  }
  class FakeWebContentsView {
    static instances: FakeWebContentsView[] = []
    webContents = new FakeWebContents()
    setVisible = vi.fn()
    setBounds = vi.fn()
    constructor(readonly options: { webPreferences?: { partition?: string } }) {
      FakeWebContentsView.instances.push(this)
    }
  }
  class FakeBrowserWindow {
    destroyed = false
    closed: (() => void) | null = null
    webContents = { owner: this, send: vi.fn() }
    childViews: FakeWebContentsView[] = []
    contentView = {
      addChildView: vi.fn((view: FakeWebContentsView) => this.childViews.push(view)),
      removeChildView: vi.fn((view: FakeWebContentsView) => { this.childViews = this.childViews.filter((entry) => entry !== view) }),
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
    static fromWebContents(sender: unknown) {
      return (sender as { owner?: FakeBrowserWindow }).owner ?? null
    }
  }
  const invoke = new Map<string, Listener>()
  const events = new Map<string, Listener>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Listener) => invoke.set(channel, handler)),
    on: vi.fn((channel: string, handler: Listener) => events.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => invoke.delete(channel)),
    removeListener: vi.fn((channel: string, handler: Listener) => {
      if (events.get(channel) === handler) events.delete(channel)
    }),
  }
  return { FakeBrowserWindow, FakeWebContentsView, invoke, events, ipcMain }
})

vi.mock('electron', () => ({
  BrowserWindow: electron.FakeBrowserWindow,
  WebContentsView: electron.FakeWebContentsView,
  ipcMain: electron.ipcMain,
}))

const { registerPreviewIpc } = await import('@acorn/plugin-preview/main/previewService.ts')
const { driverFor } = await import('@acorn/plugin-preview/main/browserService.ts')
const { WebviewService } = await import('./webviewService')

let dispose: () => void
const eventFor = (owner: InstanceType<typeof electron.FakeBrowserWindow>) => ({ sender: owner.webContents })
const ensure = (owner: InstanceType<typeof electron.FakeBrowserWindow>, taskId: string, url: string) =>
  electron.invoke.get('preview:ensure')!(eventFor(owner), { taskId, url })

beforeEach(() => {
  vi.clearAllMocks()
  electron.invoke.clear()
  electron.events.clear()
  electron.FakeWebContentsView.instances.length = 0
  dispose = registerPreviewIpc({
    viewService: new WebviewService(),
    tunnelHeadersFor: (url) => url.startsWith('http://127.0.0.1:4321/') ? { 'x-acorn-tunnel': 'secret' } : null,
  })
})

afterEach(() => dispose())

describe('preview over the generic view service', () => {
  it('retains preview partition names and opts only preview into CDP', () => {
    const owner = new electron.FakeBrowserWindow()
    expect(ensure(owner, 'task-1', 'http://localhost:3000')).toBe(true)
    expect(ensure(owner, 'task-2', 'http://localhost:3001')).toBe(true)
    expect(electron.FakeWebContentsView.instances.map((view) => view.options.webPreferences?.partition)).toEqual([
      'acorn-preview-task-1',
      'acorn-preview-task-2',
    ])
    expect(driverFor('task-1')).not.toBeNull()
    owner.close()
    expect(driverFor('task-1')).toBeNull()
  })

  it('preserves browse state until the configured home changes', () => {
    const owner = new electron.FakeBrowserWindow()
    ensure(owner, 'task-1', 'http://localhost:3000')
    const view = electron.FakeWebContentsView.instances[0]!
    view.webContents.url = 'http://localhost:3000/deep'
    ensure(owner, 'task-1', 'http://localhost:3000')
    expect(view.webContents.loadURL).toHaveBeenCalledOnce()
    ensure(owner, 'task-1', 'http://localhost:4000')
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('http://localhost:4000')
  })

  it('attaches preview tunnel headers only to URLs claimed by the preview tunnel', () => {
    const owner = new electron.FakeBrowserWindow()
    ensure(owner, 'task-1', 'http://127.0.0.1:4321/')
    const session = electron.FakeWebContentsView.instances[0]!.webContents.session
    const headers = (url: string) => {
      let result: Record<string, string> = {}
      session.beforeSendHeaders?.({ url, requestHeaders: { accept: '*/*' } }, (next) => { result = next.requestHeaders })
      return result
    }
    expect(headers('http://127.0.0.1:4321/app.js')).toEqual({ accept: '*/*', 'x-acorn-tunnel': 'secret' })
    expect(headers('https://example.com/pixel')).toEqual({ accept: '*/*' })
  })
})
