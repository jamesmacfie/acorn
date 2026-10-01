import { beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))

beforeEach(() => {
  vi.resetModules()
  native.invoke.mockReset().mockResolvedValue(true)
  native.listen.mockReset().mockResolvedValue(() => {})
})

it('registers the native listener before ensure replays retained browsing state', async () => {
  let registered!: () => void
  native.listen.mockImplementation(() => new Promise((resolve) => {
    registered = () => resolve(() => {})
  }))
  const transport = await import('./webviewTransport')
  const observer = vi.fn()
  const off = transport.onWebviewState(observer, (key) => key === 'preview:a')
  const ensured = transport.webviewOperation('preview:a', 'webview_ensure', { url: 'http://localhost:3000' })
  await vi.waitFor(() => expect(native.listen).toHaveBeenCalledOnce())
  expect(native.invoke).not.toHaveBeenCalled()
  registered()
  await ensured
  const state = { key: 'preview:a', url: 'http://localhost:3000/settings', loading: false, canGoBack: true, canGoForward: false }
  native.listen.mock.calls[0][1]({ payload: state })
  expect(observer).toHaveBeenCalledWith(state)
  off()
  native.listen.mock.calls[0][1]({ payload: state })
  expect(observer).toHaveBeenCalledOnce()
})

it('invalidates an in-flight ensure and queued show before retiring an owner', async () => {
  let finish!: (value: boolean) => void
  native.invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const transport = await import('./webviewTransport')
  const ensured = transport.webviewOperation('preview:a', 'webview_ensure', { url: 'http://localhost:3000' })
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce())
  const shown = transport.webviewOperation('preview:a', 'webview_show')
  transport.evictPreviews()
  const replacement = transport.webviewOperation('preview:a', 'webview_ensure', { url: 'http://localhost:3001' })
  finish(true)
  expect(await ensured).toBe(false)
  expect(await shown).toBe(false)
  expect(await replacement).toBe(true)
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['webview_ensure', 'webview_evict_previews', 'webview_ensure'])
})

it('keeps plugin retirement ordered and does not evict plugin pages on a preview Node switch', async () => {
  const transport = await import('./webviewTransport')
  await transport.webviewOperation('plugin:db:n:pane', 'webview_ensure', { url: 'https://example.com', hosts: ['example.com'] })
  transport.evictPreviews()
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('webview_evict_previews'))
  transport.evictWebview('plugin:db:n:pane')
  await transport.webviewOperation('plugin:db:n:pane', 'webview_ensure', { url: 'https://other.example', hosts: ['other.example'] })
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['webview_ensure', 'webview_evict_previews', 'webview_evict', 'webview_ensure'])
})

it('retires untracked native previews and blocks a different task until retirement completes', async () => {
  let finish!: () => void
  native.invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(undefined) }))
  const transport = await import('./webviewTransport')
  transport.evictPreviews()
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('webview_evict_previews'))
  const ensured = transport.webviewOperation('preview:new-node-task', 'webview_ensure', { url: 'http://localhost:3001' })
  await Promise.resolve()
  expect(native.invoke).toHaveBeenCalledOnce()
  finish()
  expect(await ensured).toBe(true)
})
