import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => unknown

  class FakeWebContents {
    private listeners = new Map<string, Listener[]>()
    destroyed = false
    devToolsOpened = false
    loading = false
    url = ''
    loadURL = vi.fn(async (url: string) => { this.url = url })
    close = vi.fn(() => { this.destroyed = true })
    closeDevTools = vi.fn(() => { this.devToolsOpened = false })
    openDevTools = vi.fn((_options?: unknown) => { this.devToolsOpened = true })
    reload = vi.fn()
    stop = vi.fn()
    getURL = () => this.url
    isDestroyed = () => this.destroyed
    isDevToolsOpened = () => this.devToolsOpened
    isLoading = () => this.loading
    setWindowOpenHandler = vi.fn()
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    }
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
    constructor(_options?: unknown) { FakeWebContentsView.instances.push(this) }
  }

  class FakeBrowserWindow {
    destroyed = false
    private listeners = new Map<string, Listener>()
    webContents = { owner: this, send: vi.fn() }
    childViews: FakeWebContentsView[] = []
    contentView = {
      addChildView: vi.fn((view: FakeWebContentsView) => { this.childViews.push(view) }),
      removeChildView: vi.fn((view: FakeWebContentsView) => {
        this.childViews = this.childViews.filter((candidate) => candidate !== view)
      }),
    }
    isDestroyed = () => this.destroyed
    once(event: string, listener: Listener) {
      this.listeners.set(event, listener)
      return this
    }
    close() {
      this.destroyed = true
      this.listeners.get('closed')?.()
    }
    static fromWebContents(sender: unknown) {
      return (sender as { owner?: FakeBrowserWindow }).owner ?? null
    }
  }

  const invokeHandlers = new Map<string, Listener>()
  const eventHandlers = new Map<string, Listener>()
  const ipcMain = {
    handle: vi.fn((channel: string, listener: Listener) => invokeHandlers.set(channel, listener)),
    on: vi.fn((channel: string, listener: Listener) => eventHandlers.set(channel, listener)),
    removeHandler: vi.fn((channel: string) => invokeHandlers.delete(channel)),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      if (eventHandlers.get(channel) === listener) eventHandlers.delete(channel)
    }),
  }

  return { FakeBrowserWindow, FakeWebContentsView, invokeHandlers, eventHandlers, ipcMain }
})

const browserBindings = vi.hoisted(() => ({
  bindBrowserContents: vi.fn(),
  unbindBrowserContents: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: electron.FakeBrowserWindow,
  WebContentsView: electron.FakeWebContentsView,
  ipcMain: electron.ipcMain,
}))
vi.mock('./browserService', () => browserBindings)

const { registerPreviewIpc } = await import('./previewService')

type TestWindow = InstanceType<typeof electron.FakeBrowserWindow>
const eventFor = (win: TestWindow) => ({ sender: win.webContents })
const ensure = (win: TestWindow, taskId: string, url: string) =>
  electron.invokeHandlers.get('preview:ensure')?.(eventFor(win), { taskId, url })

let dispose: () => void
beforeEach(() => {
  vi.clearAllMocks()
  electron.invokeHandlers.clear()
  electron.eventHandlers.clear()
  electron.FakeWebContentsView.instances.length = 0
  dispose = registerPreviewIpc()
})
afterEach(() => dispose())

describe('previewService lifecycle', () => {
  it('preserves browse state for the same home and reloads only when home changes', () => {
    const win = new electron.FakeBrowserWindow()
    expect(ensure(win, 'task-1', 'http://localhost:3000')).toBe(true)
    const view = electron.FakeWebContentsView.instances[0]
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)

    view.webContents.url = 'http://localhost:3000/deep/form'
    expect(ensure(win, 'task-1', 'http://localhost:3000')).toBe(true)
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)

    expect(ensure(win, 'task-1', 'http://localhost:4000')).toBe(true)
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('http://localhost:4000')
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('closes and unbinds owner views so a replacement window gets a fresh surface', () => {
    const firstWindow = new electron.FakeBrowserWindow()
    ensure(firstWindow, 'task-1', 'http://localhost:3000')
    const firstView = electron.FakeWebContentsView.instances[0]

    firstWindow.close()
    expect(firstView.webContents.close).toHaveBeenCalledOnce()
    expect(browserBindings.unbindBrowserContents).toHaveBeenCalledWith('task-1', firstView.webContents)

    const replacementWindow = new electron.FakeBrowserWindow()
    ensure(replacementWindow, 'task-1', 'http://localhost:3000')
    const replacementView = electron.FakeWebContentsView.instances[1]
    expect(replacementWindow.contentView.addChildView).toHaveBeenCalledWith(replacementView)
    expect(browserBindings.bindBrowserContents).toHaveBeenCalledTimes(2)
  })

  it('toggles detached devtools only for a preview owned by the requesting window', () => {
    const owner = new electron.FakeBrowserWindow()
    const otherWindow = new electron.FakeBrowserWindow()
    ensure(owner, 'task-1', 'http://localhost:3000')
    const view = electron.FakeWebContentsView.instances[0]
    const command = electron.eventHandlers.get('preview:command')

    command?.(eventFor(otherWindow), { taskId: 'task-1', action: 'devtools' })
    expect(view.webContents.openDevTools).not.toHaveBeenCalled()

    command?.(eventFor(owner), { taskId: 'task-1', action: 'devtools' })
    expect(view.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })

    command?.(eventFor(owner), { taskId: 'task-1', action: 'devtools' })
    expect(view.webContents.closeDevTools).toHaveBeenCalledOnce()
  })
})
