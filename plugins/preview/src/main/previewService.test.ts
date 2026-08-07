import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => unknown

  // The per-view session. It is a fake with real behaviour rather than a stub of vi.fn()s, because the
  // three things registered on it are the whole of the view's hardening (docs/vNext/security.md
  // § Execution boundaries) and a test that only checked they were CALLED would not notice one of them
  // answering the wrong way.
  class FakeSession {
    permissionRequestHandler: ((wc: unknown, permission: string, cb: (allowed: boolean) => void) => void) | null = null
    permissionCheckHandler: (() => boolean) | null = null
    beforeSendHeaders: ((details: { url: string; requestHeaders: Record<string, string> }, cb: (r: { requestHeaders: Record<string, string> }) => void) => void) | null = null
    setPermissionRequestHandler = vi.fn((handler: FakeSession['permissionRequestHandler']) => {
      this.permissionRequestHandler = handler
    })
    setPermissionCheckHandler = vi.fn((handler: FakeSession['permissionCheckHandler']) => {
      this.permissionCheckHandler = handler
    })
    webRequest = {
      onBeforeSendHeaders: vi.fn((handler: FakeSession['beforeSendHeaders']) => {
        this.beforeSendHeaders = handler
      }),
    }
  }

  class FakeWebContents {
    private listeners = new Map<string, Listener[]>()
    session = new FakeSession()
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
    // Retained so the partition can be asserted: an ephemeral, per-task one is the difference between
    // "each preview has its own cookie jar" and "every preview shares the app's default session".
    readonly options: { webPreferences?: { partition?: string } }
    constructor(options?: unknown) {
      this.options = (options ?? {}) as { webPreferences?: { partition?: string } }
      FakeWebContentsView.instances.push(this)
    }
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
// What the injected tunnel lookup was asked about, so the "never leaves loopback" property can be
// checked from the call site rather than trusted.
let headerLookups: string[]
beforeEach(() => {
  vi.clearAllMocks()
  electron.invokeHandlers.clear()
  electron.eventHandlers.clear()
  electron.FakeWebContentsView.instances.length = 0
  headerLookups = []
  dispose = registerPreviewIpc({
    tunnelHeadersFor: (url) => {
      headerLookups.push(url)
      // Stands in for PreviewTunnels.headersFor, whose own loopback/port matching is tested in
      // apps/desktop/src/app/main/previewTunnel.test.ts. Here the question is only whether the view
      // consults it and merges what it returns.
      return url.startsWith('http://127.0.0.1:4321/') ? { 'x-acorn-tunnel': 'sekret' } : null
    },
  })
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

// docs/vNext/security.md § Execution boundaries requires all three of these, and until Phase 5 the repo
// had none of them: previews ran on the app's DEFAULT session, no permission handler existed anywhere in
// the tree, and the preview tunnel's loopback listener carried no credential at all.
describe('the preview view is a hardened, isolated guest', () => {
  it('gets its own ephemeral partition per task, so two previews share no storage', () => {
    const win = new electron.FakeBrowserWindow()
    ensure(win, 'task-1', 'http://localhost:3000')
    ensure(win, 'task-2', 'http://localhost:3001')
    const [first, second] = electron.FakeWebContentsView.instances
    expect(first.options.webPreferences?.partition).toBe('acorn-preview-task-1')
    expect(second.options.webPreferences?.partition).toBe('acorn-preview-task-2')
    // No `persist:` prefix — the session must die with the process rather than leaving a third-party
    // page's cookies on disk.
    for (const view of [first, second]) expect(view.options.webPreferences?.partition).not.toMatch(/^persist:/)
  })

  it('denies every permission, whether the page asks or merely checks', () => {
    const win = new electron.FakeBrowserWindow()
    ensure(win, 'task-1', 'http://localhost:3000')
    const { session } = electron.FakeWebContentsView.instances[0].webContents

    // The request path: a page calling getUserMedia, Notification.requestPermission, and so on.
    const answers: boolean[] = []
    session.permissionRequestHandler?.({}, 'media', (allowed) => answers.push(allowed))
    session.permissionRequestHandler?.({}, 'notifications', (allowed) => answers.push(allowed))
    expect(answers).toEqual([false, false])

    // The check path, which is the one easy to forget: a page told "granted" here proceeds without ever
    // firing a request, so a missing check handler makes the request handler unreachable.
    expect(session.permissionCheckHandler?.()).toBe(false)
  })

  it('attaches the tunnel secret to a tunnel URL and to nothing else', () => {
    const win = new electron.FakeBrowserWindow()
    ensure(win, 'task-1', 'http://127.0.0.1:4321/')
    const { session } = electron.FakeWebContentsView.instances[0].webContents

    const headersFor = (url: string): Record<string, string> => {
      let out: Record<string, string> = {}
      session.beforeSendHeaders?.({ url, requestHeaders: { accept: '*/*' } }, (r) => {
        out = r.requestHeaders
      })
      return out
    }

    // The document, a subresource and the dev server's HMR upgrade all go through this one hook, which is
    // why the header is attached here rather than on the URL the pane is told to load.
    expect(headersFor('http://127.0.0.1:4321/')).toEqual({ accept: '*/*', 'x-acorn-tunnel': 'sekret' })
    expect(headersFor('http://127.0.0.1:4321/assets/app.js')).toMatchObject({ 'x-acorn-tunnel': 'sekret' })
    // A page served through a tunnel can link anywhere; attaching the secret to an outbound request would
    // hand it to a third party. The caller-supplied headers still pass through untouched.
    expect(headersFor('https://example.com/pixel.gif')).toEqual({ accept: '*/*' })
    expect(headerLookups).toContain('https://example.com/pixel.gif')
  })
})
