import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => unknown

  class FakeWebContents {
    private listeners = new Map<string, Listener[]>()
    destroyed = false
    devToolsOpened = false
    findRequestId = 0
    loading = false
    url = ''
    loadURL = vi.fn(async (url: string) => { this.url = url })
    close = vi.fn(() => { this.destroyed = true })
    closeDevTools = vi.fn(() => { this.devToolsOpened = false })
    findInPage = vi.fn((_text: string, _options?: unknown) => ++this.findRequestId)
    focus = vi.fn()
    openDevTools = vi.fn((_options?: unknown) => { this.devToolsOpened = true })
    reload = vi.fn()
    stop = vi.fn()
    stopFindInPage = vi.fn()
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
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
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
    webContents = { owner: this, focus: vi.fn(), send: vi.fn() }
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

  it('opens the renderer find bar for an unshifted Ctrl/Cmd+F focused in the preview page', () => {
    const owner = new electron.FakeBrowserWindow()
    ensure(owner, 'task-1', 'http://localhost:3000')
    const view = electron.FakeWebContentsView.instances[0]
    const prevented = vi.fn()

    view.webContents.emit('before-input-event', { preventDefault: prevented }, {
      type: 'keyDown',
      key: 'f',
      control: true,
      meta: false,
      alt: false,
      shift: false,
    })

    expect(prevented).toHaveBeenCalledOnce()
    expect(owner.webContents.focus).toHaveBeenCalledOnce()
    expect(owner.webContents.send).toHaveBeenCalledWith('preview:find-requested', { taskId: 'task-1' })

    prevented.mockClear()
    owner.webContents.send.mockClear()
    view.webContents.emit('before-input-event', { preventDefault: prevented }, {
      type: 'keyDown',
      key: 'f',
      control: true,
      meta: false,
      alt: false,
      shift: true,
    })
    expect(prevented).not.toHaveBeenCalled()
    expect(owner.webContents.send).not.toHaveBeenCalled()
  })

  it('finds and traverses page text while ignoring stale and foreign-window results', () => {
    const owner = new electron.FakeBrowserWindow()
    const otherWindow = new electron.FakeBrowserWindow()
    ensure(owner, 'task-1', 'http://localhost:3000')
    const view = electron.FakeWebContentsView.instances[0]
    const find = electron.eventHandlers.get('preview:find')

    find?.(eventFor(otherWindow), { taskId: 'task-1', text: 'acorn', direction: 'initial' })
    expect(view.webContents.findInPage).not.toHaveBeenCalled()

    find?.(eventFor(owner), { taskId: 'task-1', text: 'acorn', direction: 'initial' })
    expect(view.webContents.findInPage).toHaveBeenLastCalledWith('acorn', { forward: true, findNext: true })

    find?.(eventFor(owner), { taskId: 'task-1', text: 'acorn', direction: 'backward' })
    expect(view.webContents.findInPage).toHaveBeenLastCalledWith('acorn', { forward: false, findNext: false })

    owner.webContents.send.mockClear()
    view.webContents.emit('found-in-page', {}, {
      requestId: 1,
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: true,
    })
    expect(owner.webContents.send).not.toHaveBeenCalled()

    view.webContents.emit('found-in-page', {}, {
      requestId: 2,
      activeMatchOrdinal: 3,
      matches: 3,
      finalUpdate: true,
    })
    expect(owner.webContents.send).toHaveBeenCalledWith('preview:find-result', {
      taskId: 'task-1',
      activeMatchOrdinal: 3,
      matches: 3,
      finalUpdate: true,
    })
  })

  it('stops find and returns focus only for the requesting window own preview', () => {
    const owner = new electron.FakeBrowserWindow()
    const otherWindow = new electron.FakeBrowserWindow()
    ensure(owner, 'task-1', 'http://localhost:3000')
    const view = electron.FakeWebContentsView.instances[0]
    const stopFind = electron.eventHandlers.get('preview:stop-find')
    const focus = electron.eventHandlers.get('preview:focus')

    stopFind?.(eventFor(otherWindow), { taskId: 'task-1', action: 'clearSelection' })
    focus?.(eventFor(otherWindow), { taskId: 'task-1' })
    expect(view.webContents.stopFindInPage).not.toHaveBeenCalled()
    expect(view.webContents.focus).not.toHaveBeenCalled()

    stopFind?.(eventFor(owner), { taskId: 'task-1', action: 'keepSelection' })
    focus?.(eventFor(owner), { taskId: 'task-1' })
    expect(view.webContents.stopFindInPage).toHaveBeenCalledWith('keepSelection')
    expect(view.webContents.focus).toHaveBeenCalledOnce()
    expect(owner.webContents.send).toHaveBeenCalledWith('preview:find-result', {
      taskId: 'task-1',
      activeMatchOrdinal: 0,
      matches: 0,
      finalUpdate: true,
    })
  })
})
