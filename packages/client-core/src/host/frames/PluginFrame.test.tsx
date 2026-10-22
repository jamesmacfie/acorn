import { MessageChannel, MessagePort } from 'node:worker_threads'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/plugin/bridge.ts'
import type { FrameBinding } from './broker'
import type { PluginFrameProps } from './frameServices'
import PluginFrame from './PluginFrame'
import { setBundleSource } from '../tree/sandboxOrigin'

const mocks = vi.hoisted(() => ({
  unwatch: vi.fn(),
  on: vi.fn(() => vi.fn()),
  emitError: vi.fn(),
  endSpan: vi.fn(),
}))

vi.mock('@tanstack/solid-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('./frameServices', () => ({ createFrameServices: () => ({}) }))
vi.mock('../../kit/tokens/appearance', () => ({ watchAppearance: () => mocks.unwatch }))
vi.mock('../registries/commands/clientEvents', () => ({
  clientEvents: { on: mocks.on },
  consumePaneIntent: () => undefined,
}))
vi.mock('../../infra/telemetry/emitter', () => ({
  startSpan: () => ({ end: mocks.endSpan }),
  emitError: mocks.emitError,
  emitEvent: vi.fn(),
  emitLog: vi.fn(),
  recordDuration: vi.fn(),
}))

const binding: FrameBinding = {
  pluginId: 'board',
  surface: 'board',
  target: 'pane',
  nodeId: 'node-a',
  taskId: 'task-1',
  api: [],
  events: [],
  panes: ['board'],
  claimsKeys: [],
}

const mounted: (() => void)[] = []

function mount(overrides: Partial<Pick<PluginFrameProps, 'controllerOnly' | 'webview' | 'hash'>> = {}, load = true) {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <PluginFrame binding={binding} hash="abc123" {...overrides} />, host)
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    dispose()
    host.remove()
  }
  mounted.push(cleanup)
  const frame = host.querySelector('iframe')!
  const target = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  if (load) frame.dispatchEvent(new Event('load'))
  const transferred = (target.mock.calls[0] as unknown[] | undefined)?.[2] as MessagePort[] | undefined
  return { host, frame, target, transferred: transferred?.[0], dispose: cleanup }
}

function firstMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data)
    port.start()
  })
}

beforeEach(() => {
  vi.stubGlobal('MessageChannel', MessageChannel)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setBundleSource(null)
  mocks.on.mockClear()
  mocks.unwatch.mockClear()
  mocks.emitError.mockClear()
  mocks.endSpan.mockClear()
})

describe('PluginFrame', () => {
  it('connects the hash-addressed iframe and clears its deadline when the bundle speaks', async () => {
    const { frame, target, transferred } = mount()
    expect(frame.getAttribute('src')).toBe('app-plugin://abc123/index.html')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(target).toHaveBeenCalledWith({ acornBridge: PLUGIN_BRIDGE_VERSION }, 'app-plugin://abc123', [transferred])
    expect(transferred).toBeDefined()
    expect(await firstMessage(transferred!)).toMatchObject({
      kind: 'ready',
      context: { surface: 'board', nodeId: 'node-a', taskId: 'task-1' },
    })

    transferred!.postMessage({ kind: 'connected' })
    await vi.waitFor(() => expect(mocks.endSpan).toHaveBeenCalledWith())
    vi.advanceTimersByTime(10_000)
    expect(document.querySelector('.contribution-failed')).toBeNull()
    expect(mocks.emitError).not.toHaveBeenCalled()
    transferred!.close()
  })

  it('replaces a silent frame after 10 seconds and releases its subscriptions', () => {
    const { host, transferred } = mount()
    const close = vi.spyOn(MessagePort.prototype, 'close')
    expect(host.querySelector('iframe')).not.toBeNull()
    vi.advanceTimersByTime(9_999)
    expect(host.querySelector('iframe')).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.textContent).toContain('This plugin’s UI failed to start')
    expect(mocks.emitError).toHaveBeenCalledWith('board', expect.objectContaining({ name: 'FrameNeverConnected' }))
    expect(close).toHaveBeenCalledTimes(2)
    expect(mocks.unwatch).toHaveBeenCalledOnce()
    for (const call of mocks.on.mock.results) expect(call.value).toHaveBeenCalledOnce()
    transferred?.close()
  })

  it('keeps a controller frame mounted without a startup deadline', () => {
    const { host, frame, transferred } = mount({ controllerOnly: true })
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    vi.advanceTimersByTime(10_001)
    expect(host.querySelector('iframe')).toBe(frame)
    expect(mocks.emitError).not.toHaveBeenCalled()
    transferred?.close()
  })

  it('releases the port, appearance watcher, event listeners, and webview subscription on unmount', () => {
    const unwebview = vi.fn()
    const { transferred, dispose } = mount({
      webview: {
        navigate: async () => true,
        command: async () => true,
        subscribe: () => unwebview,
      },
    })
    const close = vi.spyOn(MessagePort.prototype, 'close')
    dispose()
    expect(close).toHaveBeenCalledTimes(2)
    expect(mocks.unwatch).toHaveBeenCalledOnce()
    expect(unwebview).toHaveBeenCalledOnce()
    for (const call of mocks.on.mock.results) expect(call.value).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    transferred?.close()
  })

  it('does not connect an iframe that loads after its host unmounts', () => {
    const { frame, target, dispose } = mount({}, false)
    dispose()
    frame.dispatchEvent(new Event('load'))
    expect(target).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('PluginFrame on the phone', () => {
  // The SHA-256 of no bytes, and its label in packages/client-core/src/host/tree/bundleLabel.test.ts.
  const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const ORIGIN = 'https://4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq.sandbox.test'
  const NONCE = 'd1a01ee1-0f3b-4e02-8402-cedcb4d84d02'

  beforeEach(() => {
    vi.stubGlobal('__ACORN_SANDBOX_DOMAIN__', 'sandbox.test')
    vi.stubGlobal('crypto', { randomUUID: () => NONCE })
  })

  const say = (frame: HTMLIFrameElement, kind: string) =>
    window.dispatchEvent(
      new MessageEvent('message', { origin: ORIGIN, source: frame.contentWindow, data: { kind, nonce: NONCE } }),
    )

  it('posts the bundle when the frame page is ready and connects the bridge once the page has run it', async () => {
    const bytes = new TextEncoder().encode('export {}').buffer
    setBundleSource(async () => bytes)
    const { frame, target } = mount({ hash: HASH }, false)
    expect(frame.getAttribute('src')).toBe(`${ORIGIN}/frame.html#${NONCE}`)

    say(frame, 'acorn:frame-ready')
    await vi.waitFor(() =>
      expect(target).toHaveBeenCalledExactlyOnceWith(
        { kind: 'acorn:frame-bundle', nonce: NONCE, bundle: bytes },
        ORIGIN,
      ),
    )
    // The document's own load event isn't the start: the bundle hasn't run yet.
    frame.dispatchEvent(new Event('load'))
    expect(target).toHaveBeenCalledTimes(1)

    say(frame, 'acorn:frame-loaded')
    await vi.waitFor(() => expect(target).toHaveBeenCalledTimes(2))
    expect(target).toHaveBeenLastCalledWith({ acornBridge: PLUGIN_BRIDGE_VERSION }, ORIGIN, [expect.anything()])
  })

  it('shows the failed-to-start placeholder when the page refuses the bytes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setBundleSource(async () => new Uint8Array([1]).buffer)
    const { host, frame, target } = mount({ hash: HASH }, false)
    say(frame, 'acorn:frame-ready')
    await vi.waitFor(() => expect(target).toHaveBeenCalledOnce())
    say(frame, 'acorn:frame-error')
    await vi.waitFor(() => expect(host.textContent).toContain('This plugin’s UI failed to start'))
    expect(host.querySelector('iframe')).toBeNull()
    expect(mocks.emitError).toHaveBeenCalledWith('board', expect.objectContaining({ name: 'FrameBundleRefused' }))
  })

  it('shows it too when this device has no source for the bundle', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { host, frame } = mount({ hash: HASH }, false)
    say(frame, 'acorn:frame-ready')
    await vi.waitFor(() => expect(host.textContent).toContain('This plugin’s UI failed to start'))
  })
})
