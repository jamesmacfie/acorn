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
type WireAbortSignal = { __acornRpc: 'abort-signal'; aborted: boolean; reason?: unknown }

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
  readonly #functions = new Map<number, (...args: never[]) => unknown>()
  readonly #pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()
  readonly #remoteFunctions = new Map<number, (...args: unknown[]) => unknown>()
  #nextFunctionId = 1
  #nextCallId = 1
  readonly #port: MessagePort
  readonly #mode: FunctionMode

  constructor(port: MessagePort, mode: FunctionMode) {
    this.#port = port
    this.#mode = mode
    port.on('message', (message: unknown) => this.#enqueue(message))
    port.start()
  }

  async encode(value: unknown, path = 'value'): Promise<unknown> {
    if (typeof value === 'function') {
      const id = this.#nextFunctionId++
      this.#functions.set(id, value as (...args: never[]) => unknown)
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
      return {
        __acornRpc: 'abort-signal',
        aborted: value.aborted,
        ...(value.aborted ? { reason: await this.encode(value.reason, `${path}.reason`) } : {}),
      } satisfies WireAbortSignal
    }
    if (Array.isArray(value)) return Promise.all(value.map((item, index) => this.encode(item, `${path}[${index}]`)))
    if (!isRecord(value) || value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value

    const out: Record<string, unknown> = {}
    // Plain objects carry data. Class instances carry their public method surface only: copying own
    // fields from SecretService, for example, would put its encryption key on the wire.
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype === Object.prototype || prototype === null) {
      for (const [key, item] of Object.entries(value)) out[key] = await this.encode(item, `${path}.${key}`)
      return out
    }
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue
      const item = (value as Record<string, unknown>)[key]
      if (typeof item === 'function') out[key] = await this.encode(item.bind(value), `${path}.${key}`)
    }
    return out
  }

  decode(value: unknown, path = 'value'): unknown {
    if (Array.isArray(value)) return value.map((item, index) => this.decode(item, `${path}[${index}]`))
    if (!isRecord(value)) return value
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
      return wire.aborted ? AbortSignal.abort(this.decode(wire.reason, `${path}.reason`)) : new AbortController().signal
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = this.decode(item, `${path}.${key}`)
    return out
  }

  async call(functionId: number, args: unknown[], path = 'call'): Promise<unknown> {
    const callId = this.#nextCallId++
    const encoded = await this.encode(args, `${path}.args`) as unknown[]
    return new Promise((resolve, reject) => {
      this.#pending.set(callId, { resolve, reject })
      this.#port.postMessage({ __acornRpc: 'call', callId, functionId, args: encoded } satisfies WireRequest)
    })
  }

  close(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
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
      this.#functions.set(id, value as (...args: never[]) => unknown)
      return { __acornRpc: 'function', id, sync: this.#mode(path, value as (...args: never[]) => unknown) === 'sync' } satisfies WireFunction
    }
    if (Array.isArray(value)) return value.map((item, index) => this.#encodeSync(item, `${path}[${index}]`))
    if (!isRecord(value) || value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = this.#encodeSync(item, `${path}.${key}`)
    return out
  }

  #enqueue(message: unknown): void {
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
      try {
        const fn = this.#functions.get(request.functionId)
        if (!fn) throw new Error(`Unknown plugin RPC function ${request.functionId}.`)
        const value = await fn(...this.decode(request.args, 'remote.args') as never[])
        this.#port.postMessage({ __acornRpc: 'result', callId: request.callId, ok: true, value: await this.encode(value, 'remote.result') } satisfies WireResponse)
      } catch (error) {
        this.#port.postMessage({ __acornRpc: 'result', callId: request.callId, ok: false, value: errorToWire(error) } satisfies WireResponse)
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
      const fn = this.#functions.get(request.functionId)
      if (!fn) throw new Error(`Unknown plugin RPC function ${request.functionId}.`)
      const value = fn(...this.decode(request.args, 'remote.sync.args') as never[])
      if (value instanceof Promise) throw new Error('An asynchronous plugin callback crossed a synchronous RPC seam.')
      payload = { ok: true, value: this.#encodeSync(value, 'remote.sync.result') }
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
    const value = this.decode(response.value, 'remote.result')
    if (response.ok) pending.resolve(value)
    else pending.reject(value)
  }
}

export const rpcError = errorToWire
