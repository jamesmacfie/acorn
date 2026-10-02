// Symmetric transport for the host and a permissioned loaded-plugin worker. Ownership policy lives
// beside the transport; permissions remain in the context the host exports.
import { receiveMessageOnPort, type MessagePort } from 'node:worker_threads'
import { deserialize, serialize } from 'node:v8'
import { readRpcBody } from './rpcBody.ts'
import { isInvocationOwned, pluginRpcFunctionLifetime } from './rpcOwnership.ts'
import { RpcReferences, type FunctionMode, type RpcFunction, type RpcScope, type WireFunction } from './rpcReferences.ts'
import {
  bodyBuffer, carriesItsOwnShape, errorFromWire, errorToWire, HEADER_BYTES, isRecord,
  SYNC_REPLY_BYTES, SYNC_REPLY_TIMEOUT_MS,
  type WireAbort, type WireAbortSignal, type WireError, type WireRequest, type WireRequestValue,
  type WireResponse, type WireResponseValue, type WireSyncRequest,
} from './rpcValues.ts'

// Statuses that must not carry a body. The constructor throws on any body for these, even an empty
// one, so a plugin's 204 became a 500 after its handler had already done the work. The same set as
// ../middleware/idempotency.ts.
const BODILESS = new Set([204, 205, 304])

type Encoding = {
  created: Set<number>
  scope?: RpcScope
  scopedArguments?: boolean
  terminal?: string
  scopedResults?: boolean
  signalIds?: Set<number>
  callId?: number
  failed?: boolean
  alive(): boolean
  cancelled?: Promise<Error>
}
type Pending = {
  resolve(value: unknown): void
  reject(error: unknown): void
  encoding: Encoding
  posted: boolean
  ownerScope?: RemoteScope
}
type Incoming = { signalIds: Set<number>; argumentScope?: number; cancelled: boolean; cancel(error: Error): void; cancellation: Promise<Error> }
type RemoteScope = { id: number; functions: Set<number>; retired: boolean }
type RemoteFunction = { fn: (...args: unknown[]) => unknown; retired: boolean; scope?: RemoteScope }

export class PluginRpcEndpoint {
  readonly #references: RpcReferences
  readonly #pending = new Map<number, Pending>()
  readonly #incoming = new Map<number, Incoming>()
  readonly #remoteFunctions = new Map<number, RemoteFunction>()
  readonly #remoteScopes = new Map<number, RemoteScope>()
  readonly #localSignals = new Map<number, { signal: AbortSignal; listener: () => void; posted: boolean; sent: boolean; encoding: Encoding }>()
  readonly #remoteSignals = new Map<number, AbortController>()
  // A buffer returns to the pool only after its reply. A timed-out buffer may still be written to.
  readonly #replyBuffers: SharedArrayBuffer[] = []
  readonly #retirement = new AbortController()
  #closed: Error | undefined
  #nextCallId = 1
  #nextSignalId = 1
  #bodyReads = 0
  readonly #port: MessagePort

  constructor(port: MessagePort, mode: FunctionMode) {
    this.#port = port
    this.#references = new RpcReferences(mode, (ids) => this.#post({ __acornRpc: 'release', ids }))
    port.on('message', (message: unknown) => this.#enqueue(message))
    port.on('close', () => this.close(new Error('Plugin RPC peer closed.')))
    port.start()
  }

  /** Internal transport diagnostics; no reference or captured authority leaves the endpoint. */
  referenceCounts() {
    return {
      functions: this.#references.functions.size, remoteFunctions: this.#remoteFunctions.size,
      scopes: this.#references.scopes.size, pending: this.#pending.size, incoming: this.#incoming.size,
      localSignals: this.#localSignals.size, remoteSignals: this.#remoteSignals.size,
      replyBuffers: this.#replyBuffers.length,
      bodyReads: this.#bodyReads,
      remoteScopes: this.#remoteScopes.size,
    }
  }

  #check(encoding?: Encoding): void {
    if (this.#closed) throw this.#closed
    if (encoding && (encoding.failed || !encoding.alive())) throw new Error('Plugin RPC invocation has ended.')
  }

  #post(message: unknown): void {
    this.#check()
    this.#port.postMessage(message)
  }

  async encode(value: unknown, path = 'value', signalIds?: Set<number>, encoding?: Encoding, inheritedScope?: RpcScope, requestRoot?: string): Promise<unknown> {
    const transaction = encoding ?? { created: new Set<number>(), signalIds, alive: () => !this.#closed }
    try {
      this.#check(transaction)
      if (!encoding) {
        const encoded = await this.encode(value, path, signalIds, transaction, inheritedScope, requestRoot)
        this.#references.commit(transaction.created)
        return encoded
      }
      const scope = inheritedScope ?? (transaction.scopedArguments ? transaction.scope : undefined)
      if (typeof value === 'function') {
        const lifetime = pluginRpcFunctionLifetime(path, requestRoot)
        return this.#references.export(value as RpcFunction, path, transaction.created, scope, transaction.terminal !== undefined && path.endsWith(`.${transaction.terminal}`), lifetime, !lifetime.persistentResult && (requestRoot !== undefined || !!transaction.scopedResults))
      }
      if (value instanceof Error) return errorToWire(value)
      if (value instanceof Request) {
        // Track before reading the body: cancellation can arrive while encoding has no posted call.
        const signal = await this.#encodeSignal(value.signal, `${path}.signal`, transaction, true)
        const body = value.body ? await this.#readBody(value.body, transaction, value.signal) : null
        this.#check(transaction)
        return { __acornRpc: 'request', url: value.url, method: value.method, headers: [...value.headers.entries()], body, signal } satisfies WireRequestValue
      }
      if (value instanceof Response) {
        const body = value.body ? await this.#readBody(value.body, transaction) : new Uint8Array()
        this.#check(transaction)
        return { __acornRpc: 'response', status: value.status, statusText: value.statusText, headers: [...value.headers.entries()], body } satisfies WireResponseValue
      }
      if (value instanceof AbortSignal) return this.#encodeSignal(value, path, transaction)
      if (Array.isArray(value)) return await Promise.all(value.map((item, index) => this.encode(item, `${path}[${index}]`, signalIds, transaction, scope, requestRoot)))
      if (!isRecord(value) || carriesItsOwnShape(value)) return value
      const ownedScope = isInvocationOwned(value) ? (transaction.scope ??= this.#references.scope()) : scope
      const ownedRoot = isInvocationOwned(value) ? path : requestRoot
      const out: Record<string, unknown> = {}
      const prototype = Object.getPrototypeOf(value) as object | null
      if (prototype === Object.prototype || prototype === null) {
        for (const [key, item] of Object.entries(value)) out[key] = await this.encode(item, `${path}.${key}`, signalIds, transaction, ownedScope, ownedRoot)
      } else {
        // Class fields can contain secrets. Export public methods, with one binding per instance.
        for (const key of Object.getOwnPropertyNames(prototype)) {
          if (key === 'constructor') continue
          const item = value[key]
          if (typeof item === 'function') out[key] = await this.encode(this.#references.bind(value, item as RpcFunction), `${path}.${key}`, signalIds, transaction, ownedScope, ownedRoot)
        }
      }
      this.#check(transaction)
      return out
    } catch (error) {
      transaction.failed = true
      if (!encoding) this.#references.rollback(transaction.created)
      throw error
    }
  }

  async #readBody(body: ReadableStream<Uint8Array>, encoding: Encoding, signal?: AbortSignal): Promise<Uint8Array> {
    this.#bodyReads++
    try { return await readRpcBody(body, this.#retirement.signal, () => this.#check(encoding), encoding.cancelled, signal) }
    finally { this.#bodyReads-- }
  }

  async #encodeSignal(signal: AbortSignal, path: string, encoding: Encoding, requestSignal = false): Promise<WireAbortSignal> {
    this.#check(encoding)
    const id = encoding.signalIds && !signal.aborted ? this.#nextSignalId++ : undefined
    if (id !== undefined) {
      const listener = () => {
        this.#sendAbort(id)
        if (requestSignal && encoding.callId !== undefined) this.#cancelPending(encoding.callId, signal.reason)
      }
      this.#localSignals.set(id, { signal, listener, posted: false, sent: false, encoding })
      encoding.signalIds!.add(id)
      signal.addEventListener('abort', listener, { once: true })
    }
    return { __acornRpc: 'abort-signal', ...(id === undefined ? {} : { id }), aborted: signal.aborted,
      ...(signal.aborted ? { reason: await this.encode(signal.reason, `${path}.reason`, undefined, encoding, this.#reasonScope(encoding, signal.reason)) } : {}) }
  }

  decode(value: unknown, path = 'value', signalIds?: Set<number>, retiredScope?: number): unknown {
    this.#check()
    if (Array.isArray(value)) return value.map((item, index) => this.decode(item, `${path}[${index}]`, signalIds, retiredScope))
    if (!isRecord(value) || carriesItsOwnShape(value)) return value
    if (value.__acornRpc === 'function') {
      const wire = value as WireFunction
      if (wire.scopeId !== undefined && wire.scopeId === retiredScope) throw new Error('Plugin RPC invocation has ended.')
      const cached = this.#remoteFunctions.get(wire.id)
      if (cached) return cached.fn
      const entry: RemoteFunction = { fn: () => {}, retired: false }
      let ended = false
      entry.fn = (...args: unknown[]) => {
        if (wire.terminal && ended) return wire.sync ? undefined : Promise.resolve()
        this.#check()
        if (entry.retired) throw new Error('Plugin RPC invocation has ended.')
        if (wire.terminal) ended = true
        return wire.sync ? this.#callSync(wire, args, path) : this.call(wire.id, args, path, wire.scopedArguments)
      }
      this.#remoteFunctions.set(wire.id, entry)
      if (wire.scopeId !== undefined) {
        let scope = this.#remoteScopes.get(wire.scopeId)
        if (!scope) this.#remoteScopes.set(wire.scopeId, scope = { id: wire.scopeId, functions: new Set(), retired: false })
        entry.scope = scope
        scope.functions.add(wire.id)
      }
      return entry.fn
    }
    if (value.__acornRpc === 'error') return errorFromWire(value as WireError)
    if (value.__acornRpc === 'request') {
      const wire = value as WireRequestValue
      return new Request(wire.url, { method: wire.method, headers: wire.headers, signal: this.decode(wire.signal, `${path}.signal`, signalIds, retiredScope),
        ...(wire.body ? { body: bodyBuffer(wire.body), duplex: 'half' } : {}) } as RequestInit)
    }
    if (value.__acornRpc === 'response') {
      const wire = value as WireResponseValue
      return new Response(BODILESS.has(wire.status) ? null : bodyBuffer(wire.body), { status: wire.status, statusText: wire.statusText, headers: wire.headers })
    }
    if (value.__acornRpc === 'abort-signal') {
      const wire = value as WireAbortSignal
      if (wire.aborted) return AbortSignal.abort(this.decode(wire.reason, `${path}.reason`, signalIds, retiredScope))
      const controller = new AbortController()
      if (wire.id !== undefined) { this.#remoteSignals.set(wire.id, controller); signalIds?.add(wire.id) }
      return controller.signal
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = this.decode(item, `${path}.${key}`, signalIds, retiredScope)
    return out
  }

  call(functionId: number, args: unknown[], path = 'call', scopedArguments = false): Promise<unknown> {
    if (this.#closed) return Promise.reject(this.#closed)
    const callId = this.#nextCallId++
    const scope = scopedArguments ? this.#references.scope() : undefined
    const encoding: Encoding = { created: new Set(), scope, scopedArguments, signalIds: new Set(), callId, alive: () => this.#pending.has(callId) }
    // Register before encoding so close also settles a caller blocked on a Request body.
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, encoding, posted: false, ownerScope: this.#remoteFunctions.get(functionId)?.scope }
      this.#pending.set(callId, pending)
      void this.encode(args, `${path}.args`, encoding.signalIds, encoding).then((encoded) => {
        this.#check(encoding)
        this.#post({ __acornRpc: 'call', callId, functionId, args: encoded as unknown[], argumentScope: encoding.scope?.id } satisfies WireRequest)
        if (encoding.scope) encoding.scope.sent = true
        this.#references.commit(encoding.created)
        pending.posted = true
        for (const id of encoding.signalIds!) {
          const tracked = this.#localSignals.get(id)
          if (tracked) { tracked.posted = true; if (tracked.signal.aborted) this.#sendAbort(id) }
        }
      }).catch((error) => {
        this.#references.rollback(encoding.created)
        if (this.#pending.delete(callId)) { this.#finish(pending); reject(error) }
      })
    })
  }

  #cancelPending(callId: number, reason: unknown): void {
    const pending = this.#pending.get(callId)
    if (!pending) return
    if (pending.posted) {
      // The cancellation itself carries the reason; abort-reason encoding may still be pending.
      try {
        const encoded = this.#encodeSync(reason, 'cancel.reason', pending.encoding, this.#reasonScope(pending.encoding, reason))
        this.#post({ __acornRpc: 'cancel', callId, reason: encoded })
        this.#references.commit(pending.encoding.created)
      } catch (error) {
        this.#references.rollback(pending.encoding.created)
        this.#post({ __acornRpc: 'cancel', callId, reason: errorToWire(error) })
      }
    }
    this.#pending.delete(callId)
    this.#finish(pending)
    pending.reject(abortError(reason))
  }

  #finish(pending: Pending): void {
    this.#clearLocalSignals(pending.encoding.signalIds!)
    if (pending.encoding.scope) this.#references.retire(pending.encoding.scope)
  }

  #sendAbort(id: number): void {
    const tracked = this.#localSignals.get(id)
    if (!tracked?.posted || tracked.sent || !tracked.signal.aborted || this.#closed) return
    tracked.sent = true
    void this.encode(tracked.signal.reason, 'abort.reason', undefined, tracked.encoding, this.#reasonScope(tracked.encoding, tracked.signal.reason)).then((reason) => {
      if (this.#localSignals.has(id) && !this.#closed) {
        this.#post({ __acornRpc: 'abort', id, reason } satisfies WireAbort)
        this.#references.commit(tracked.encoding.created)
      }
    }).catch(() => { this.#references.rollback(tracked.encoding.created) })
  }

  #reasonScope(encoding: Encoding, reason: unknown): RpcScope | undefined {
    if (typeof reason === 'function' || (isRecord(reason) && !(reason instanceof Error))) encoding.scope ??= this.#references.scope()
    return encoding.scope
  }

  #clearLocalSignals(ids: Iterable<number>): void {
    for (const id of ids) {
      const tracked = this.#localSignals.get(id)
      if (tracked) { tracked.signal.removeEventListener('abort', tracked.listener); this.#localSignals.delete(id) }
    }
  }

  close(error: Error): void {
    if (this.#closed) return
    this.#closed = error
    this.#retirement.abort(error)
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    this.#clearLocalSignals(this.#localSignals.keys())
    for (const incoming of this.#incoming.values()) incoming.cancel(error)
    this.#incoming.clear()
    for (const controller of this.#remoteSignals.values()) controller.abort(error)
    this.#remoteSignals.clear()
    this.#references.close()
    for (const remote of this.#remoteFunctions.values()) remote.retired = true
    this.#remoteFunctions.clear()
    this.#remoteScopes.clear()
    this.#replyBuffers.length = 0
    this.#port.close()
  }

  #encodeSync(value: unknown, path: string, encoding: Encoding, scope?: RpcScope, requestRoot?: string): unknown {
    this.#check(encoding)
    if (value instanceof Error) return errorToWire(value)
    if (typeof value === 'function') {
      const lifetime = pluginRpcFunctionLifetime(path, requestRoot)
      return this.#references.export(value as RpcFunction, path, encoding.created, scope, encoding.terminal !== undefined && path.endsWith(`.${encoding.terminal}`), lifetime, !lifetime.persistentResult && (requestRoot !== undefined || !!encoding.scopedResults))
    }
    if (Array.isArray(value)) return value.map((item, index) => this.#encodeSync(item, `${path}[${index}]`, encoding, scope, requestRoot))
    if (!isRecord(value) || carriesItsOwnShape(value)) return value
    const out: Record<string, unknown> = {}
    const ownedScope = isInvocationOwned(value) ? (encoding.scope ??= this.#references.scope()) : scope
    const ownedRoot = isInvocationOwned(value) ? path : requestRoot
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype === Object.prototype || prototype === null) {
      for (const [key, item] of Object.entries(value)) out[key] = this.#encodeSync(item, `${path}.${key}`, encoding, ownedScope, ownedRoot)
    } else {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor') continue
        const item = value[key]
        if (typeof item === 'function') out[key] = this.#encodeSync(this.#references.bind(value, item as RpcFunction), `${path}.${key}`, encoding, ownedScope, ownedRoot)
      }
    }
    return out
  }

  #callSync(wire: WireFunction, args: unknown[], path: string): unknown {
    const scope = wire.scopedArguments ? this.#references.scope() : undefined
    const encoding: Encoding = { created: new Set(), scope, alive: () => !this.#closed }
    try {
      const encoded = this.#encodeSync(args, `${path}.args`, encoding, wire.scopedArguments ? scope : undefined) as unknown[]
      const reply = this.#replyBuffers.pop() ?? new SharedArrayBuffer(SYNC_REPLY_BYTES)
      const control = new Int32Array(reply, 0, 2)
      Atomics.store(control, 0, 0)
      this.#post({ __acornRpc: 'sync-call', functionId: wire.id, args: encoded, reply, argumentScope: encoding.scope?.id } satisfies WireSyncRequest)
      if (encoding.scope) encoding.scope.sent = true
      this.#references.commit(encoding.created)
      const deadline = Date.now() + SYNC_REPLY_TIMEOUT_MS
      while (Atomics.load(control, 0) === 0) {
        if (Date.now() >= deadline) throw new Error(`A synchronous plugin call (${path}) went unanswered for ${SYNC_REPLY_TIMEOUT_MS}ms.`)
        const nested = receiveMessageOnPort(this.#port)?.message
        if (nested) this.#enqueue(nested)
        else Atomics.wait(control, 0, 0, 10)
      }
      const length = Atomics.load(control, 1)
      const payload = deserialize(new Uint8Array(reply, HEADER_BYTES, length)) as { ok: boolean; value: unknown }
      this.#replyBuffers.push(reply)
      const decoded = this.decode(payload.value, `${path}.result`)
      if (!payload.ok) throw decoded
      return decoded
    } catch (error) {
      this.#references.rollback(encoding.created)
      throw error
    } finally { if (encoding.scope) this.#references.retire(encoding.scope) }
  }

  #enqueue(message: unknown): void {
    if (this.#closed || !isRecord(message)) return
    if (message.__acornRpc === 'abort') {
      const wire = message as WireAbort
      this.#remoteSignals.get(wire.id)?.abort(this.decode(wire.reason, 'abort.reason'))
    } else if (message.__acornRpc === 'cancel') {
      const incoming = this.#incoming.get(message.callId as number)
      if (!incoming) return
      incoming.cancelled = true
      const reason = this.decode(message.reason, 'cancel.reason')
      for (const id of incoming.signalIds) { this.#remoteSignals.get(id)?.abort(reason); this.#remoteSignals.delete(id) }
      incoming.cancel(abortError(reason))
      this.#retireRemoteScope(incoming.argumentScope)
      this.#incoming.delete(message.callId as number)
    } else if (message.__acornRpc === 'release') {
      for (const id of message.ids as number[]) {
        this.#retireRemote(id)
      }
      for (const [scopeId, scope] of this.#remoteScopes) {
        for (const id of message.ids as number[]) scope.functions.delete(id)
        if (!scope.functions.size) { scope.retired = true; this.#remoteScopes.delete(scopeId) }
      }
    } else if (message.__acornRpc === 'result') this.#settle(message as WireResponse)
    // Answer synchronously while the peer waits, including nested calls. Async handlers remain
    // concurrent so a slow provider cannot prevent an unrelated route from answering.
    else if (message.__acornRpc === 'sync-call') this.#answerSync(message as WireSyncRequest)
    else if (message.__acornRpc === 'call') void this.#handle(message as WireRequest).catch(() => {})
  }

  async #handle(request: WireRequest): Promise<void> {
    let cancel!: (error: Error) => void
    const incoming: Incoming = { signalIds: new Set(), argumentScope: request.argumentScope, cancelled: false, cancel: (error) => cancel(error), cancellation: new Promise((resolve) => { cancel = resolve }) }
    this.#incoming.set(request.callId, incoming)
    const entry = this.#references.functions.get(request.functionId)
    const resultScope = entry?.lifetime.resultTerminal ? { scope: this.#references.scope(), terminal: entry.lifetime.resultTerminal } : undefined
    const encoding: Encoding = { created: new Set(), scope: resultScope?.scope ?? (entry?.scopedResult ? entry.scope : undefined), terminal: resultScope?.terminal, scopedResults: !!resultScope || entry?.scopedResult,
      alive: () => !this.#closed && !incoming.cancelled, cancelled: incoming.cancellation }
    let leave: (() => void) | undefined
    try {
      if (!entry) throw new Error(`Unknown plugin RPC function ${request.functionId}.`)
      leave = this.#references.enter(entry)
      const value = await entry.fn(...this.decode(request.args, 'remote.args', incoming.signalIds) as never[])
      this.#check(encoding)
      const encoded = await this.encode(value, `${entry.path}.result`, undefined, encoding, encoding.scope)
      this.#check(encoding)
      this.#post({ __acornRpc: 'result', callId: request.callId, ok: true, value: encoded } satisfies WireResponse)
      this.#references.commit(encoding.created)
    } catch (error) {
      this.#references.rollback(encoding.created)
      if (resultScope) this.#references.retire(resultScope.scope)
      if (!this.#closed && !incoming.cancelled) this.#post({ __acornRpc: 'result', callId: request.callId, ok: false, value: errorToWire(error) } satisfies WireResponse)
    } finally {
      leave?.()
      this.#incoming.delete(request.callId)
      for (const id of incoming.signalIds) this.#remoteSignals.delete(id)
      this.#retireRemoteScope(request.argumentScope)
    }
  }

  #answerSync(request: WireSyncRequest): void {
    const entry = this.#references.functions.get(request.functionId)
    const resultScope = entry?.lifetime.resultTerminal ? { scope: this.#references.scope(), terminal: entry.lifetime.resultTerminal } : undefined
    const encoding: Encoding = { created: new Set(), scope: resultScope?.scope ?? (entry?.scopedResult ? entry.scope : undefined), terminal: resultScope?.terminal, scopedResults: !!resultScope || entry?.scopedResult, alive: () => !this.#closed }
    let payload: { ok: boolean; value: unknown }
    let leave: (() => void) | undefined
    try {
      if (!entry) throw new Error(`Unknown plugin RPC function ${request.functionId}.`)
      leave = this.#references.enter(entry)
      const value = entry.fn(...this.decode(request.args, 'remote.sync.args') as never[])
      if (value instanceof Promise) {
        // The rejected sync contract must still observe the callback it already started.
        void value.catch(() => {})
        throw new Error('An asynchronous plugin callback crossed a synchronous RPC seam.')
      }
      payload = { ok: true, value: this.#encodeSync(value, `${entry.path}.result`, encoding, encoding.scope) }
    } catch (error) {
      this.#references.rollback(encoding.created)
      if (resultScope) this.#references.retire(resultScope.scope)
      payload = { ok: false, value: errorToWire(error) }
    }
    try {
      let bytes: Uint8Array
      try { bytes = serialize(payload) }
      catch (error) {
        this.#references.rollback(encoding.created)
        if (resultScope) this.#references.retire(resultScope.scope)
        bytes = serialize({ ok: false, value: errorToWire(error) })
      }
      if (bytes.byteLength > request.reply.byteLength - HEADER_BYTES) {
        this.#references.rollback(encoding.created)
        if (resultScope) this.#references.retire(resultScope.scope)
        bytes = serialize({ ok: false, value: errorToWire(new Error('Plugin RPC synchronous reply exceeded 4 MiB.')) })
      }
      const control = new Int32Array(request.reply, 0, 2)
      new Uint8Array(request.reply, HEADER_BYTES, bytes.byteLength).set(bytes)
      Atomics.store(control, 1, bytes.byteLength)
      Atomics.store(control, 0, 1)
      Atomics.notify(control, 0)
      this.#references.commit(encoding.created)
    } finally { leave?.(); this.#retireRemoteScope(request.argumentScope) }
  }

  #retireRemote(id: number): void {
    const remote = this.#remoteFunctions.get(id)
    if (remote) remote.retired = true
    this.#remoteFunctions.delete(id)
  }

  #retireRemoteScope(scopeId?: number): void {
    if (scopeId === undefined) return
    const scope = this.#remoteScopes.get(scopeId)
    if (scope) { scope.retired = true; for (const id of scope.functions) this.#retireRemote(id); scope.functions.clear() }
    this.#remoteScopes.delete(scopeId)
  }

  #settle(response: WireResponse): void {
    const pending = this.#pending.get(response.callId)
    if (!pending) return
    this.#pending.delete(response.callId)
    try {
      const value = this.decode(response.value, 'remote.result', undefined, pending.ownerScope?.retired ? pending.ownerScope.id : undefined)
      if (response.ok) pending.resolve(value)
      else pending.reject(value)
    } catch (error) { pending.reject(error) }
    finally { this.#finish(pending) }
  }
}

const abortError = (reason: unknown): Error => reason instanceof Error ? reason : new DOMException(String(reason ?? 'The operation was aborted.'), 'AbortError')
export const rpcError = errorToWire
