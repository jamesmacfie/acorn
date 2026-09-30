import { describe, expect, it, vi } from 'vitest'
import { tasksRoute } from '@acorn/protocol/api.ts'
import { createFrameBridge, type FrameApiResult, type FrameBinding, type FrameBytesResult, type FrameServices } from './broker'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settled = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const jsonResult: FrameApiResult = { ok: true, status: 200, body: 'answer' }
const bytesResult: FrameBytesResult = { ok: true, status: 200, bytes: new Uint8Array([1]), type: 'text/plain', filename: null }
const request = (kind: string, id = 1) => ({ kind, id, method: 'GET', path: tasksRoute })

// A synchronous port exposes the admission and completion boundaries without timer races. The
// separate broker suite exercises the wire over real MessageChannels.
function host(target: FrameBinding['target'] = 'pane', authorize?: () => boolean) {
  const posted: unknown[] = []
  const port = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: (message: unknown) => posted.push(message), close: vi.fn(), start: () => {} }
  const json = deferred<FrameApiResult>()
  const bytes = deferred<FrameBytesResult>()
  const native = deferred<void>()
  const navigate = deferred<boolean>()
  const signals: AbortSignal[] = []
  const services: FrameServices = {
    fetch: vi.fn((_method, _path, _body, signal) => { signals.push(signal); return json.promise }),
    fetchBytes: vi.fn((_method, _path, _body, signal) => { signals.push(signal); return bytes.promise }),
    subscribe: () => () => {}, stateGet: () => null, stateSet: vi.fn(() => native.promise),
    toast: vi.fn(), copy: vi.fn(), openPane: vi.fn(), openUrl: vi.fn(), frameHasFocus: () => true,
    importerDone: vi.fn(), importerClose: vi.fn(), keydown: vi.fn(),
    document: { read: () => '', write: vi.fn(), flush: vi.fn(() => native.promise) },
    webviewNavigate: vi.fn(() => navigate.promise), webviewCommand: vi.fn(() => navigate.promise),
  }
  const misbehaving = vi.fn()
  const bridge = createFrameBridge({
    port: port as unknown as MessagePort,
    binding: { pluginId: 'test', surface: 'test', target, nodeId: 'n', api: ['core.tasks:read'], events: [], panes: [], claimsKeys: [], hosts: ['example.com'] },
    services, context: { surface: 'test', target, nodeId: 'n', theme: 'dark', style: 'terminal' },
    onMisbehaving: misbehaving, ...(authorize ? { authorize } : {}),
  })
  posted.length = 0
  return { posted, services, signals, misbehaving, bridge, json, bytes, native, navigate,
    send: (data: unknown) => port.onmessage?.({ data } as MessageEvent) }
}

describe('bridge request ownership', () => {
  it.each([['api', 'api'], ['api.bytes', 'api.bytes'], ['api', 'api.bytes'], ['api.bytes', 'api']])(
    'closes duplicate live %s / %s ids before another effect or ambiguous reply', async (first, second) => {
      const h = host()
      h.send(request(first))
      h.send(request(second))
      expect(h.misbehaving).toHaveBeenCalledOnce()
      expect(vi.mocked(h.services.fetch).mock.calls.length + vi.mocked(h.services.fetchBytes).mock.calls.length).toBe(1)
      expect(h.signals[0]!.aborted).toBe(true)
      h.json.resolve(jsonResult)
      h.bytes.resolve(bytesResult)
      await settled()
      expect(h.posted).toEqual([])
      h.bridge.dispose()
    },
  )

  it.each(['api', 'api.bytes'])('does not let cancelled %s success, failure, or cleanup affect a reused id', async (kind) => {
    for (const reject of [false, true]) {
      const h = host()
      h.send(request(kind))
      h.send({ id: 9, kind: 'cancel', target: 1 })
      h.send(request(kind === 'api' ? 'api.bytes' : 'api'))
      expect(h.signals[0]!.aborted).toBe(true)
      const previous = kind === 'api' ? h.json : h.bytes
      if (reject) previous.reject(new Error('cancelled synthetic request'))
      else if (kind === 'api') h.json.resolve(jsonResult)
      else h.bytes.resolve(bytesResult)
      await settled()
      expect(h.posted).toEqual([])
      if (kind === 'api') h.bytes.resolve(bytesResult)
      else h.json.resolve(jsonResult)
      await settled()
      expect(h.posted).toHaveLength(1)
      expect(h.posted[0]).toMatchObject({ id: 1, ok: true })
      h.send({ id: 1, kind: 'ui', op: 'copy', text: 'completed reuse' })
      expect(h.services.copy).toHaveBeenCalledOnce()
      expect(h.misbehaving).not.toHaveBeenCalled()
      h.bridge.dispose()
    }
  })

  it.each(['api', 'cancel'])('admits 100 distinct calls and aborts all on the next %s message', async (kind) => {
    const h = host()
    for (let id = 1; id <= 100; id++) h.send(request(id % 2 ? 'api' : 'api.bytes', id))
    expect(h.signals).toHaveLength(100)
    h.send(kind === 'cancel' ? { id: 101, kind, target: 1 } : request(kind, 101))
    expect(h.misbehaving).toHaveBeenCalledWith('more than 100 requests in flight')
    expect(h.signals.every((signal) => signal.aborted)).toBe(true)
    h.json.resolve(jsonResult)
    h.bytes.resolve(bytesResult)
    await settled()
    expect(h.posted).toEqual([])
  })

  it('closes a duplicate before a changed authority can reply against the original id', async () => {
    let authorized = true
    const h = host('pane', () => authorized)
    h.send(request('api'))
    authorized = false
    h.send(request('api.bytes'))
    expect(h.misbehaving).toHaveBeenCalledOnce()
    expect(h.services.fetchBytes).not.toHaveBeenCalled()
    expect(h.signals[0]!.aborted).toBe(true)
    h.json.resolve(jsonResult)
    await settled()
    expect(h.posted).toEqual([])
  })

  it('counts native handlers toward the distinct request cap and suppresses replies after disposal', async () => {
    const h = host()
    for (let id = 1; id <= 100; id++) h.send({ id, kind: 'state.set', key: 'test', value: 'value' })
    h.send(request('api', 101))
    expect(h.services.stateSet).toHaveBeenCalledTimes(100)
    expect(h.services.fetch).not.toHaveBeenCalled()
    expect(h.misbehaving).toHaveBeenCalledOnce()
    h.native.resolve()
    await settled()
    expect(h.posted).toEqual([])
  })

  it('dispose aborts every admitted call and suppresses late success and failure', async () => {
    const h = host()
    h.send(request('api'))
    h.send(request('api.bytes', 2))
    h.bridge.dispose()
    expect(h.signals.every((signal) => signal.aborted)).toBe(true)
    h.json.resolve(jsonResult)
    h.bytes.reject(new Error('late synthetic failure'))
    await settled()
    expect(h.posted).toEqual([])
  })

  it.each([
    { kind: 'state.set', key: 'test', value: 'value' },
    { kind: 'document', op: 'flush' },
    { kind: 'webview', op: 'navigate', url: 'https://example.com/' },
    { kind: 'webview', op: 'reload' },
  ])('tracks asynchronous $kind $op effects and suppresses their cancelled replies', async (message) => {
    const h = host('webview')
    h.send({ id: 1, ...message })
    h.send({ id: 9, kind: 'cancel', target: 1 })
    h.send(request('api'))
    h.native.resolve()
    h.navigate.resolve(true)
    await settled()
    expect(h.posted).toEqual([])
    h.json.resolve(jsonResult)
    await settled()
    expect(h.posted).toEqual([{ id: 1, ok: true, status: 200, body: 'answer' }])
    h.bridge.dispose()
  })

  it('refuses a synchronous effect reusing an asynchronous native request id', async () => {
    const h = host()
    h.send({ id: 1, kind: 'state.set', key: 'test', value: 'value' })
    h.send({ id: 1, kind: 'ui', op: 'copy', text: 'duplicate' })
    expect(h.services.copy).not.toHaveBeenCalled()
    expect(h.misbehaving).toHaveBeenCalledOnce()
    h.native.resolve()
    await settled()
    expect(h.posted).toEqual([])
  })
})


describe('actual outstanding bridge work', () => {
  it.each([
    { message: { kind: 'state.set', key: 'test', value: 'value' }, service: 'stateSet' as const },
    { message: { kind: 'document', op: 'flush' }, service: 'flush' as const },
    { message: { kind: 'webview', op: 'navigate', url: 'https://example.com/' }, service: 'webviewNavigate' as const },
    { message: { kind: 'webview', op: 'reload' }, service: 'webviewCommand' as const },
  ])('counts cancelled $service work until settlement', async ({ message, service }) => {
    const h = host('webview')
    for (let i = 0; i < 100; i++) {
      h.send({ id: 1, ...message })
      if (i < 99) h.send({ id: 9, kind: 'cancel', target: 1 })
    }
    const effect = service === 'flush' ? h.services.document!.flush : h.services[service]
    expect(effect).toHaveBeenCalledTimes(100)
    expect(h.misbehaving).not.toHaveBeenCalled()
    h.send({ id: 2, ...message })
    expect(effect).toHaveBeenCalledTimes(100)
    expect(h.misbehaving).toHaveBeenCalledWith('more than 100 requests in flight')
    h.native.resolve()
    h.navigate.resolve(true)
    await settled()
    expect(h.posted).toEqual([])
    h.bridge.dispose()
  })

  it('counts API work that ignores abort while allowing cancelled ids to be reused below the cap', async () => {
    const h = host()
    for (let i = 0; i < 100; i++) {
      h.send(request(i % 2 ? 'api.bytes' : 'api'))
      if (i < 99) h.send({ id: 9, kind: 'cancel', target: 1 })
    }
    expect(h.signals).toHaveLength(100)
    expect(h.misbehaving).not.toHaveBeenCalled()
    h.send(request('api', 2))
    expect(h.signals).toHaveLength(100)
    expect(h.signals.every((signal) => signal.aborted)).toBe(true)
    expect(h.misbehaving).toHaveBeenCalledOnce()
    h.json.resolve(jsonResult)
    h.bytes.reject(new Error('late synthetic byte failure'))
    await settled()
    expect(h.posted).toEqual([])
    h.bridge.dispose()
  })

  it('releases the work quota on cancelled native settlement without releasing a reused id', async () => {
    const h = host()
    h.send({ id: 1, kind: 'state.set', key: 'test', value: 'value' })
    h.send({ id: 9, kind: 'cancel', target: 1 })
    for (let id = 1; id <= 98; id++) h.send(request('api', id))
    h.native.resolve()
    await settled()
    expect(h.posted).toEqual([])
    h.send(request('api', 99))
    h.send(request('api', 100))
    expect(h.signals).toHaveLength(100)
    expect(h.misbehaving).not.toHaveBeenCalled()
    h.json.resolve(jsonResult)
    await settled()
    expect(h.posted).toHaveLength(100)
    h.send(request('api', 101))
    await settled()
    expect(h.signals).toHaveLength(101)
    expect(h.misbehaving).not.toHaveBeenCalled()
    h.bridge.dispose()
  })

  it.each(['dispose', 'duplicate'])('aborts active API work and suppresses cancelled native rejection on %s teardown', async (teardown) => {
    const h = host()
    h.send({ id: 1, kind: 'state.set', key: 'test', value: 'value' })
    h.send({ id: 9, kind: 'cancel', target: 1 })
    h.send(request('api'))
    h.send(request('api.bytes', 2))
    if (teardown === 'dispose') h.bridge.dispose()
    else h.send(request('api.bytes'))
    expect(h.signals.every((signal) => signal.aborted)).toBe(true)
    h.native.reject(new Error('cancelled synthetic native failure'))
    h.json.resolve(jsonResult)
    h.bytes.resolve(bytesResult)
    await settled()
    expect(h.posted).toEqual([])
    h.bridge.dispose()
  })
})
