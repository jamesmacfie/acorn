import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown
  class FakeBrowserWindow {
    destroyed = false
    webContents = { owner: this, send: vi.fn() }
    isDestroyed = () => this.destroyed
    static fromWebContents(sender: unknown) {
      return (sender as { owner?: FakeBrowserWindow }).owner ?? null
    }
  }
  const invoke = new Map<string, Handler>()
  const events = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => invoke.set(channel, handler)),
    on: vi.fn((channel: string, handler: Handler) => events.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => invoke.delete(channel)),
    removeListener: vi.fn(),
  }
  return { FakeBrowserWindow, invoke, events, ipcMain }
})

vi.mock('electron', () => ({ BrowserWindow: electron.FakeBrowserWindow, ipcMain: electron.ipcMain }))

const { registerPluginWebviewIpc } = await import('./pluginWebviewIpc')

const service = () => ({
  ensure: vi.fn((_options: unknown) => true),
  setBounds: vi.fn(() => true),
  show: vi.fn(() => true),
  hide: vi.fn(() => true),
  load: vi.fn(() => true),
  command: vi.fn(() => true),
  evictOwned: vi.fn(() => true),
  evictMatching: vi.fn(),
})

beforeEach(() => {
  electron.invoke.clear()
  electron.events.clear()
  vi.clearAllMocks()
})

describe('plugin webview IPC', () => {
  it('accepts only plugin-shaped keys and creates an undrivable allowlisted view', () => {
    const webviews = service()
    const dispose = registerPluginWebviewIpc(webviews as never)
    const owner = new electron.FakeBrowserWindow()
    const event = { sender: owner.webContents }
    const ensure = electron.invoke.get('plugin-webview:ensure')!
    expect(ensure(event, { key: 'preview:task-1', url: 'https://docs.example.com', hosts: ['docs.example.com'] })).toBe(false)
    expect(ensure(event, { key: 'plugin:docs:guide:task-1', url: 'https://docs.example.com', hosts: ['docs.example.com'] })).toBe(true)
    const options = webviews.ensure.mock.calls[0]![0] as {
      partitionKey: string
      allowsNavigation(url: string): boolean
    }
    expect(options).not.toHaveProperty('onAttach')
    expect(options.partitionKey).not.toMatch(/^persist:/)
    expect(options.allowsNavigation('https://docs.example.com/next')).toBe(true)
    expect(options.allowsNavigation('https://evil.example/next')).toBe(false)
    dispose()
  })

  it('authorizes every later operation against the sender-owned key', async () => {
    const webviews = service()
    registerPluginWebviewIpc(webviews as never)
    const owner = new electron.FakeBrowserWindow()
    const event = { sender: owner.webContents }
    const key = 'plugin:docs:guide:task-1'
    expect(await electron.invoke.get('plugin-webview:load')!(event, { key, url: 'https://docs.example.com/next' })).toBe(true)
    expect(webviews.load).toHaveBeenCalledWith(owner, key, 'https://docs.example.com/next')
    electron.events.get('plugin-webview:hide')!(event, { key })
    expect(webviews.hide).toHaveBeenCalledWith(owner, key)
  })
})
