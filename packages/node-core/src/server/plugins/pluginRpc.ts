// The transport shared by the host and an isolated loaded-plugin worker.
//
// Values stay structured-clone data. Functions become opaque references owned by the realm that
// created them; invoking a reference sends a call back to that owner. Registration and a handful of
// read-shaped context methods are synchronous in the public plugin API, so those references use a
// one-reply SharedArrayBuffer. Everything else is ordinary promise RPC over the MessagePort.
import { receiveMessageOnPort, type MessagePort } from 'node:worker_threads'
import { deserialize, serialize } from 'node:v8'

type WireFunction = { __acornRpc: 'function'; id: number; sync: boolean }
type WireRequest = { __acornRpc: 'call'; callId: number; functionId: number; args: unknown[] }
type WireResponse = { __acornRpc: 'result'; callId: number; ok: boolean; value: unknown }
type WireSyncRequest = { __acornRpc: 'sync-call'; functionId: number; args: unknown[]; reply: SharedArrayBuffer }
type WireError = { __acornRpc: 'error'; name: string; message: string; stack?: string; code?: unknown; status?: unknown; permission?: unknown; resource?: unknown }
type WireRequestValue = { __acornRpc: 'request'; url: string; method: string; headers: [string, string][]; body: Uint8Array | null }
type WireResponseValue = { __acornRpc: 'response'; status: number; statusText: string; headers: [string, string][]; body: Uint8Array }
type WireAbortSignal = { __acornRpc: 'abort-signal'; id?: number; aborted: boolean; reason?: unknown }
type WireAbort = { __acornRpc: 'abort'; id: number; reason: unknown }

type FunctionMode = (path: string, fn: (...args: never[]) => unknown) => 'sync' | 'async'

const SYNC_REPLY_BYTES = 4 * 1024 * 1024
// A synchronous reference is a pure, read-shaped call, so an answer is either immediate or never
// coming. Without a ceiling, a worker that crashed or wedged freezes the thread that called it, and
// on the host that thread is the node's event loop: no route answers and the broker's heartbeat
// stops, so one bad plugin reads as the whole node being unreachable.
const SYNC_REPLY_TIMEOUT_MS = 5_000
const HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 2
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
// An object that already survives a structured clone with its own shape, so neither side walks it key
// by key. `Object.entries` on a Uint8Array yields `{ '0': 26, '1': 80, … }`, and the receiver gets an
// object that looks close enough to the real thing to pass every check and then has no `.slice`.
//
// That was a live failure. A plugin reading an image through a capability got its bytes back as a
// numbered object and the route threw, which the host answered as a bare 500.
const carriesItsOwnShape = (value: unknown): boolean =>
  value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || value instanceof ArrayBuffer
const bodyBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

const errorToWire = (error: unknown): WireError => {
  const source = error instanceof Error ? error : new Error(String(error))
  return {
    __acornRpc: 'error',
    name: source.name,
    message: source.message,
    ...(source.stack ? { stack: source.stack } : {}),
    ...('code' in source ? { code: (source as Error & { code?: unknown }).code } : {}),
    // `status` travels with `code` because the pair is one answer, not two facts. A provider error
    // that arrived with its code and no status stopped looking like a provider error to the host
    // (integrations/types.ts § isProviderOperationError), so a rejected credential was reported as
    // the provider being unavailable.
    ...('status' in source ? { status: (source as Error & { status?: unknown }).status } : {}),
    ...('permission' in source ? { permission: (source as Error & { permission?: unknown }).permission } : {}),
    ...('resource' in source ? { resource: (source as Error & { resource?: unknown }).resource } : {}),
  }
}

const errorFromWire = (wire: WireError): Error => {
  const error = new Error(wire.message)
  error.name = wire.name
  if (wire.stack) error.stack = wire.stack
  if (wire.code !== undefined) (error as Error & { code?: unknown }).code = wire.code
  if (wire.status !== undefined) (error as Error & { status?: unknown }).status = wire.status
  if (wire.permission !== undefined) (error as Error & { permission?: unknown }).permission = wire.permission
  if (wire.resource !== undefined) (error as Error & { resource?: unknown }).resource = wire.resource
  return error
}

/** A small, symmetric RPC endpoint. It deliberately knows nothing about plugin permissions: the
 * object exported through it is already the owner- and permission-scoped context built by the host. */
export class PluginRpcEndpoint {
  readonly #functions = new Map<number, { fn: (...args: never[]) => unknown; path: string }>()
  readonly #pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void; signalIds: Set<number> }>()
  readonly #remoteFunctions = new Map<number, (...args: unknown[]) => unknown>()
  readonly #localSignals = new Map<number, { signal: AbortSignal; listener: () => void; posted: boolean; sent: boolean }>()
  readonly #remoteSignals = new Map<number, AbortController>()
  #nextFunctionId = 1
  #nextCallId = 1
  #nextSignalId = 1
  readonly #port: MessagePort
  readonly #mode: FunctionMode

  constructor(port: MessagePort, mode: FunctionMode) {
    this.#port = port
    this.#mode = mode
    port.on('message', (message: unknown) => this.#enqueue(message))
    port.start()
  }

  async encode(value: unknown, path = 'value', signalIds?: Set<number>): Promise<unknown> {
    if (typeof value === 'function') {
      const id = this.#nextFunctionId++
      this.#functions.set(id, { fn: value as (...args: never[]) => unknown, path })
      return { __acornRpc: 'function', id, sync: this.#mode(path, value as (...args: never[]) => unknown) === 'sync' } satisfies WireFunction
    }
    if (value instanceof Request) {
      return {
        __acornRpc: 'request',
        url: value.url,
        method: value.method,
        headers: [...value.headers.entries()],
        body: value.body ? new Uint8Array(await value.arrayBuffer()) : null,
      } satisfies WireRequestValue
    }
    if (value instanceof Response) {
      return {
        __acornRpc: 'response',
        status: value.status,
        statusText: value.statusText,
        headers: [...value.headers.entries()],
        body: new Uint8Array(await value.arrayBuffer()),
      } satisfies WireResponseValue
    }
    if (value instanceof AbortSignal) {
      // Async call arguments keep a listener until the reply. Other values carry only a snapshot.
      const id = signalIds && !value.aborted ? this.#nextSignalId++ : undefined
      if (id !== undefined) {
        const listener = () => { this.#sendAbort(id) }
        this.#localSignals.set(id, { signal: value, listener, posted: false, sent: false })
        signalIds!.add(id)
        value.addEventListener('abort', listener, { once: true })
      }
      return {
        __acornRpc: 'abort-signal',
        ...(id === undefined ? {} : { id }),
        aborted: value.aborted,
        ...(value.aborted ? { reason: await this.encode(value.reason, `${path}.reason`, signalIds) } : {}),
      } satisfies WireAbortSignal
    }
    if (Array.isArray(value)) return Promise.all(value.map((item, index) => this.encode(item, `${path}[${index}]`, signalIds)))
    if (!isRecord(value) || carriesItsOwnShape(value)) return value

    const out: Record<string, unknown> = {}
    // Plain objects carry data. Class instances carry their public method surface only: copying own
    // fields from SecretService, for example, would put its encryption key on the wire.
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype === Object.prototype || prototype === null) {
      for (const [key, item] of Object.entries(value)) out[key] = await this.encode(item, `${path}.${key}`, signalIds)
      return out
    }
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue
      const item = (value as Record<string, unknown>)[key]
      if (typeof item === 'function') out[key] = await this.encode(item.bind(value), `${path}.${key}`, signalIds)
    }
    return out
  }

  decode(value: unknown, path = 'value', signalIds?: Set<number>): unknown {
    if (Array.isArray(value)) return value.map((item, index) => this.decode(item, `${path}[${index}]`, signalIds))
    if (!isRecord(value) || carriesItsOwnShape(value)) return value
    if (value.__acornRpc === 'function') {
      const wire = value as WireFunction
      const cached = this.#remoteFunctions.get(wire.id)
      if (cached) return cached
      const remote = wire.sync
        ? (...args: unknown[]) => this.#callSync(wire.id, args, path)
        : (...args: unknown[]) => this.call(wire.id, args, path)
      this.#remoteFunctions.set(wire.id, remote)
      return remote
    }
    if (value.__acornRpc === 'error') return errorFromWire(value as WireError)
    if (value.__acornRpc === 'request') {
      const wire = value as WireRequestValue
      return new Request(wire.url, { method: wire.method, headers: wire.headers, ...(wire.body ? { body: bodyBuffer(wire.body), duplex: 'half' } : {}) } as RequestInit)
    }
    if (value.__acornRpc === 'response') {
      const wire = value as WireResponseValue
      return new Response(bodyBuffer(wire.body), { status: wire.status, statusText: wire.statusText, headers: wire.headers })
    }
    if (value.__acornRpc === 'abort-signal') {
      const wire = value as WireAbortSignal
      if (wire.aborted) return AbortSignal.abort(this.decode(wire.reason, `${path}.reason`, signalIds))
      const controller = new AbortController()
      if (wire.id !== undefined) {
        this.#remoteSignals.set(wire.id, controller)
        signalIds?.add(wire.id)
      }
      return controller.signal
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = this.decode(item, `${path}.${key}`, signalIds)
    return out
  }

  async call(functionId: number, args: unknown[], path = 'call'): Promise<unknown> {
    const callId = this.#nextCallId++
    const signalIds = new Set<number>()
    let encoded: unknown[]
    try {
      encoded = await this.encode(args, `${path}.args`, signalIds) as unknown[]
    } catch (error) {
      this.#clearLocalSignals(signalIds)
      throw error
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(callId, { resolve, reject, signalIds })
      try {
        this.#port.postMessage({ __acornRpc: 'call', callId, functionId, args: encoded } satisfies WireRequest)
      } catch (error) {
        this.#pending.delete(callId)
        this.#clearLocalSignals(signalIds)
        reject(error)
        return
      }
      for (const id of signalIds) {
        const tracked = this.#localSignals.get(id)
        if (!tracked) continue
        tracked.posted = true
        if (tracked.signal.aborted) this.#sendAbort(id)
      }
    })
  }

  #sendAbort(id: number): void {
    const tracked = this.#localSignals.get(id)
    if (!tracked?.posted || tracked.sent || !tracked.signal.aborted) return
    tracked.sent = true
    void this.encode(tracked.signal.reason, 'abort.reason').then((reason) => {
      if (this.#localSignals.has(id)) this.#port.postMessage({ __acornRpc: 'abort', id, reason } satisfies WireAbort)
    }).catch(() => {})
  }

  #clearLocalSignals(ids: Set<number>): void {
    for (const id of ids) {
      const tracked = this.#localSignals.get(id)
      if (!tracked) continue
      tracked.signal.removeEventListener('abort', tracked.listener)
      this.#localSignals.delete(id)
    }
  }

  close(error: Error): void {
    for (const pending of this.#pending.values()) {
      this.#clearLocalSignals(pending.signalIds)
      pending.reject(error)
    }
    this.#pending.clear()
    this.#remoteSignals.clear()
    this.#functions.clear()
    this.#remoteFunctions.clear()
    this.#port.close()
  }

  #callSync(functionId: number, args: unknown[], path: string): unknown {
    const reply = new SharedArrayBuffer(SYNC_REPLY_BYTES)
    const control = new Int32Array(reply, 0, 2)
    // Sync references may only receive already-cloneable data. Request/Response-bearing callbacks are
    // intentionally classified async by each side.
    const encoded = this.#encodeSync(args, `${path}.args`) as unknown[]
    this.#port.postMessage({ __acornRpc: 'sync-call', functionId, args: encoded, reply } satisfies WireSyncRequest)
    const deadline = Date.now() + SYNC_REPLY_TIMEOUT_MS
    while (Atomics.load(control, 0) === 0) {
      if (Date.now() >= deadline) throw new Error(`A synchronous plugin call (${path}) went unanswered for ${SYNC_REPLY_TIMEOUT_MS}ms.`)
      const nested = receiveMessageOnPort(this.#port)?.message
      if (nested) this.#handleSyncDuringWait(nested)
      else Atomics.wait(control, 0, 0, 10)
    }
    const length = Atomics.load(control, 1)
    const payload = deserialize(new Uint8Array(reply, HEADER_BYTES, length)) as { ok: boolean; value: unknown }
    const decoded = this.decode(payload.value, `${path}.result`)
    if (!payload.ok) throw decoded
    return decoded
  }

  #encodeSync(value: unknown, path: string): unknown {
    if (typeof value === 'function') {
      const id = this.#nextFunctionId++
      this.#functions.set(id, { fn: value as (...args: never[]) => unknown, path })
      return { __acornRpc: 'function', id, sync: this.#mode(path, value as (...args: never[]) => unknown) === 'sync' } satisfies WireFunction
    }
    if (Array.isArray(value)) return value.map((item, index) => this.#encodeSync(item, `${path}[${index}]`))
    if (!isRecord(value) || carriesItsOwnShape(value)) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = this.#encodeSync(item, `${path}.${key}`)
    return out
  }

  #enqueue(message: unknown): void {
    if (isRecord(message) && message.__acornRpc === 'abort') {
      const wire = message as WireAbort
      this.#remoteSignals.get(wire.id)?.abort(this.decode(wire.reason, 'abort.reason'))
      return
    }
    if (isRecord(message) && message.__acornRpc === 'result') {
      this.#settle(message as WireResponse)
      return
    }
    // Answered here rather than on the queue, because the peer is sitting in `Atomics.wait` until it
    // arrives. Queued, the reply waited on every call already in flight, and one of those could be a
    // route handler awaiting the very peer that is blocked: both threads then wait on each other for
    // good. `#answerSync` never awaits, so there is nothing to serialise here.
    if (isRecord(message) && message.__acornRpc === 'sync-call') {
      this.#answerSync(message as WireSyncRequest)
      return
    }
    // Concurrent, not queued. A chain here made every call to one plugin wait for the call before it
    // to finish, so a single route waiting on a slow provider stopped that plugin answering anything
    // until it returned. The fan-out's retry ladder then stacked the retries behind the request that
    // had already timed out, and the panel never recovered. Each call carries its own `callId` and
    // decodes its own arguments, so nothing here needs an order.
    void this.#handle(message).catch(() => {})
  }

  async #handle(message: unknown): Promise<void> {
    if (!isRecord(message)) return
    if (message.__acornRpc === 'call') {
      const request = message as WireRequest
      const signalIds = new Set<number>()
      try {
        const entry = this.#functions.get(request.functionId)
        if (!entry) throw new Error(`Unknown plugin RPC function ${request.functionId}.`)
        const value = await entry.fn(...this.decode(request.args, 'remote.args', signalIds) as never[])
        this.#port.postMessage({ __acornRpc: 'result', callId: request.callId, ok: true, value: await this.encode(value, 'remote.result') } satisfies WireResponse)
      } catch (error) {
        this.#port.postMessage({ __acornRpc: 'result', callId: request.callId, ok: false, value: errorToWire(error) } satisfies WireResponse)
      } finally {
        for (const id of signalIds) this.#remoteSignals.delete(id)
      }
      return
    }
  }

  #handleSyncDuringWait(message: unknown): void {
    if (!isRecord(message)) return
    if (message.__acornRpc === 'sync-call') this.#answerSync(message as WireSyncRequest)
    else if (message.__acornRpc === 'result') this.#settle(message as WireResponse)
    else this.#enqueue(message)
  }

  #answerSync(request: WireSyncRequest): void {
    let payload: { ok: boolean; value: unknown }
    try {
      const entry = this.#functions.get(request.functionId)
      if (!entry) throw new Error(`Unknown plugin RPC function ${request.functionId}.`)
      const value = entry.fn(...this.decode(request.args, 'remote.sync.args') as never[])
      if (value instanceof Promise) throw new Error('An asynchronous plugin callback crossed a synchronous RPC seam.')
      payload = { ok: true, value: this.#encodeSync(value, `${entry.path}.result`) }
    } catch (error) {
      payload = { ok: false, value: errorToWire(error) }
    }
    const bytes = serialize(payload)
    const control = new Int32Array(request.reply, 0, 2)
    if (bytes.byteLength > request.reply.byteLength - HEADER_BYTES) {
      const fallback = serialize({ ok: false, value: errorToWire(new Error('Plugin RPC synchronous reply exceeded 4 MiB.')) })
      new Uint8Array(request.reply, HEADER_BYTES, fallback.byteLength).set(fallback)
      Atomics.store(control, 1, fallback.byteLength)
    } else {
      new Uint8Array(request.reply, HEADER_BYTES, bytes.byteLength).set(bytes)
      Atomics.store(control, 1, bytes.byteLength)
    }
    Atomics.store(control, 0, 1)
    Atomics.notify(control, 0)
  }

  #settle(response: WireResponse): void {
    const pending = this.#pending.get(response.callId)
    if (!pending) return
    this.#pending.delete(response.callId)
    this.#clearLocalSignals(pending.signalIds)
    const value = this.decode(response.value, 'remote.result')
    if (response.ok) pending.resolve(value)
    else pending.reject(value)
  }
}

export const rpcError = errorToWire
