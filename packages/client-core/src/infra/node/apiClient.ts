import type { ApiError as ApiErrorBody } from '@acorn/protocol/api.ts'
import type { NodeFetchBody, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { nodeTransport } from '../platform'
import { activeNodeId } from './activeNode'
import { nodeState } from './fleet'

// The renderer's only HTTP surface. Every request goes through the desktop helper's connection broker
// (docs/architecture-overview.md § Node API and client flow), which owns the endpoint, the pinned
// certificate, and the device token, so nothing here knows an origin and nothing here holds a
// credential.
//
// readJson, writeJson and postJson keep the signatures their call sites use.

// Typed error for non-OK API responses. It carries the HTTP status so consumers branch structurally,
// such as the node-state machine's 401 handling, instead of pattern-matching message text.
// `requestId` is what makes a user-reported failure findable in the node's log.
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string
  readonly retryable: boolean
  constructor(message: string, status: number, code?: string, meta?: { requestId?: string; retryable?: boolean }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = meta?.requestId
    this.retryable = meta?.retryable ?? false
  }
}

// What a call site sees. Not a web Response, because a broker reply is fully buffered and pretending
// otherwise invites streaming code that cannot work over IPC.
export type ApiResponse = { ok: boolean; status: number; headers: Record<string, string>; body: Uint8Array }

let requestSeq = 0
const nextRequestId = (): string => `r${++requestSeq}-${Date.now()}`

const decoder = new TextDecoder()

export type ApiBody = string | NodeFetchBody

const asNodeBody = (body: ApiBody | undefined): NodeFetchBody | undefined =>
  body === undefined ? undefined : typeof body === 'string' ? { kind: 'bytes', bytes: new TextEncoder().encode(body) } : body

type SendOptions = {
  method?: string
  headers?: Record<string, string>
  body?: ApiBody
  signal?: AbortSignal
  // Explicit target, for fleet fan-out and for tests. Defaults to the active node.
  nodeId?: string
  // For a route that waits on something slow, such as a model call. The broker kills a request at 30s,
  // which is less than one model call is allowed to take, so a caller that knows it is slow has to say
  // so. Unset keeps the broker's default.
  timeoutMs?: number
}

// GET and HEAD are the reads, everything else changes something on the node. Defaults to GET, matching
// `send`.
const isMutation = (method: string | undefined): boolean => {
  const verb = (method ?? 'GET').toUpperCase()
  return verb !== 'GET' && verb !== 'HEAD'
}

// A node whose connection state means a write cannot land. Read from the broker's projection rather
// than attempted and timed out, because main already knows.
const isWritable = (nodeId: string): boolean => {
  const state = nodeState(nodeId)
  return state !== 'offline' && state !== 'revoked'
}

// The one place a request leaves the renderer.
async function send(path: string, options: SendOptions = {}): Promise<ApiResponse> {
  const transport = nodeTransport()
  const nodeId = options.nodeId ?? activeNodeId()

  if (!transport || !nodeId) {
    // A host that HAS a broker but no node picked yet. That used to be unreachable, because the window
    // opened after the fleet had answered; it now happens for the first moments of a launch with
    // nothing remembered (docs/frontend.md § Painting before the node), and a module-level prime can
    // land here. Falling through to the same-origin branch below would fetch a node route off the
    // shell's own scheme handler, which refuses those on purpose and answers with a message about the
    // API being the helper — true, and misleading about what actually went wrong. Retryable, because
    // it is about to stop being true.
    if (transport) throw new ApiError('acorn has not picked a node to talk to yet.', 0, 'no_active_node', { retryable: true })

    // No broker, so the renderer is in a plain browser served by a node (`dev:node`) or in a unit test
    // that stubs global fetch. Same-origin, so whatever auth that origin accepts applies. There is no
    // device token on this path.
    const res = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: bodyForFetch(asNodeBody(options.body)),
      signal: options.signal,
    })
    return { ok: res.ok, status: res.status, headers: headersToObject(res.headers), body: new Uint8Array(await res.arrayBuffer()) }
  }

  // Mutations fail fast and keep the user's input as a draft, with no replay queue
  // (docs/architecture-overview.md § Client state and fleet behavior).
  //
  // Fail fast rather than wait for a TCP timeout, because main already knows the node is unreachable.
  // Without the check a submit spins for the broker's 30s request timeout and then reports
  // ECONNREFUSED. A read is still worth attempting: the broker may reconnect between the status update
  // and the request, and a failed read costs a stale badge.
  //
  // `offline` and `revoked` only. `degraded` is WS down and HTTP up, where writes still work, and
  // `incompatible` gets its own message from the route it fails on.
  if (isMutation(options.method) && !isWritable(nodeId)) {
    throw new ApiError('This node is offline, so nothing was sent. Try again once it is back.', 0, 'node_offline', {
      retryable: true,
    })
  }

  const requestId = nextRequestId()
  // Abort is forwarded explicitly, because an AbortSignal cannot cross contextBridge. Main holds the
  // controller and the renderer names the request to cancel.
  const onAbort = () => transport.abort(requestId)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await transport.fetch(nodeId, {
      requestId,
      path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      ...(asNodeBody(options.body) ? { body: asNodeBody(options.body)! } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    return toApiResponse(res)
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

const toApiResponse = (res: NodeFetchResponse): ApiResponse => ({
  ok: res.status >= 200 && res.status < 300,
  status: res.status,
  headers: res.headers,
  body: res.body,
})

const headersToObject = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

const bodyForFetch = (body: NodeFetchBody | undefined): BodyInit | undefined => {
  if (!body) return undefined
  if (body.kind === 'bytes') return body.bytes.byteLength === 0 ? undefined : (body.bytes as unknown as BodyInit)
  const form = new FormData()
  for (const part of body.parts) {
    if ('value' in part) form.append(part.name, part.value)
    else form.append(part.name, new Blob([part.bytes as unknown as BlobPart], { type: part.type }), part.filename)
  }
  return form
}

const JSON_HEADERS = { 'content-type': 'application/json' }

const parseJson = <T>(res: ApiResponse): T => (res.body.byteLength === 0 ? (undefined as T) : (JSON.parse(decoder.decode(res.body)) as T))

// One place that reads the wire envelope (docs/api-reference.md § Transport). A non-JSON or
// pre-envelope body degrades to `undefined` rather than throwing over the original failure.
function errorBody(res: ApiResponse): ApiErrorBody['error'] | undefined {
  try {
    const body = JSON.parse(decoder.decode(res.body)) as Partial<ApiErrorBody>
    const error = body?.error
    return error && typeof error === 'object' && typeof error.code === 'string' ? error : undefined
  } catch {
    return undefined
  }
}

// Prefer the upstream prose in `message`, such as GitHub's verbatim 422 reason, over the machine code.
// The code is for branching, the message is for people.
const errorText = (error: ApiErrorBody['error'] | undefined, fallback: string): string => error?.message || error?.code || fallback

const raise = (res: ApiResponse, fallback: string): never => {
  const error = errorBody(res)
  throw new ApiError(errorText(error, fallback), res.status, error?.code, {
    requestId: error?.requestId,
    retryable: error?.retryable,
  })
}

type ReadOptions = { signal?: AbortSignal; nodeId?: string }

// A cast, not a parse. Within a protocol major every change is additive, so a read tolerates fields it
// does not know about (docs/api-reference.md § Versioning).
export async function readJson<T>(url: string, options: ReadOptions = {}): Promise<T> {
  const res = await send(url, { signal: options.signal, nodeId: options.nodeId })
  if (!res.ok) raise(res, `${url} ${res.status}`)
  return parseJson<T>(res)
}

// The one non-JSON read: a download. Under app:// a route builder's URL resolves against the protocol
// handler rather than a node, so it cannot be an `href` or `src`. A download comes back as bytes and
// becomes a blob URL on this side.
export async function readBytes(url: string, fallback = 'download failed'): Promise<{ bytes: Uint8Array; type: string; filename: string | null }> {
  const res = await send(url)
  if (!res.ok) raise(res, fallback)
  return {
    bytes: res.body,
    type: res.headers['content-type'] ?? 'application/octet-stream',
    filename: filenameFromDisposition(res.headers['content-disposition']),
  }
}

// Only the quoted `filename="…"` form, which is the only form acorn's routes emit. Anything else
// returns null and the caller names the file.
const filenameFromDisposition = (header: string | undefined): string | null =>
  /filename="([^"]+)"/.exec(header ?? '')?.[1] ?? null

// Reads the error prose out of a failed response. Kept as a separate export because a few call sites
// want the message without the throw.
export async function apiError(res: ApiResponse, fallback: string): Promise<string> {
  return errorText(errorBody(res), fallback)
}

// Status, parsed body, and the node's own error envelope, without the throw. Every other export here
export type RawApiResult = { ok: boolean; status: number; body: unknown; error?: ApiErrorBody['error'] }

export async function sendRaw(url: string, init: WriteInit = {}): Promise<RawApiResult> {
  const res = await send(url, init)
  const error = res.ok ? undefined : errorBody(res)
  let body: unknown
  try {
    body = parseJson<unknown>(res)
  } catch {
    // A non-JSON body is not a failure here; it is simply not something a frame can be handed.
    body = undefined
  }
  return { ok: res.ok, status: res.status, body, ...(error ? { error } : {}) }
}

/** `sendRaw`'s shape for a call whose answer is bytes rather than JSON (../../host/frames/frameServices.ts).
 *
 * The success arm keeps the body out of the JSON parser entirely, which is the whole difference: `sendRaw`
 * throws a non-JSON success body away on purpose, and an image is exactly that. The failure arm still
 * reads the node's error envelope, because a refusal is JSON whatever the request asked for. */
export type RawBytesResult =
  | { ok: true; status: number; bytes: Uint8Array; type: string; filename: string | null }
  | { ok: false; status: number; error?: ApiErrorBody['error'] }

export async function sendRawBytes(url: string, init: WriteInit = {}): Promise<RawBytesResult> {
  const res = await send(url, init)
  if (!res.ok) return { ok: false, status: res.status, ...(errorBody(res) ? { error: errorBody(res) } : {}) }
  return {
    ok: true,
    status: res.status,
    bytes: res.body,
    type: res.headers['content-type'] ?? 'application/octet-stream',
    filename: filenameFromDisposition(res.headers['content-disposition']),
  }
}

type ErrorFallback = string | ((res: ApiResponse) => string)

export async function writeJson<T>(url: string, init: WriteInit, fallback: ErrorFallback = (res) => `${res.status}`): Promise<T> {
  const res = await send(url, init)
  if (!res.ok) raise(res, typeof fallback === 'function' ? fallback(res) : fallback)
  return parseJson<T>(res)
}

// What writeJson accepts. `body` is a JSON value rather than a pre-serialized string, so the one
// place that knows the wire encoding is this module.
export type WriteInit = {
  method?: string
  headers?: Record<string, string>
  body?: ApiBody
  signal?: AbortSignal
  nodeId?: string
  timeoutMs?: number
}

// JSON POST. Throws the structured error code on failure, such as `merge_failed`, so callers branch.
export const postJson = async <T>(url: string, body?: unknown, options?: { idempotencyKey?: string }): Promise<T> =>
  writeJson<T>(url, {
    method: 'POST',
    headers: {
      ...(body === undefined ? {} : JSON_HEADERS),
      // The client mints the key, never the broker (docs/api-reference.md § Request processing).
      ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

export async function sendJson<T = void>(url: string, init: WriteInit, fallback: ErrorFallback = (res) => `${res.status}`): Promise<T> {
  const res = await send(url, init)
  if (!res.ok) raise(res, typeof fallback === 'function' ? fallback(res) : fallback)
  return parseJson<T>(res)
}

// Multipart upload. The parts are described, not encoded, so main builds the real body and the
// renderer never hand-rolls a boundary.
export async function sendForm<T>(url: string, parts: Extract<NodeFetchBody, { kind: 'form' }>['parts'], fallback = 'upload failed'): Promise<T> {
  const res = await send(url, { method: 'POST', body: { kind: 'form', parts } })
  if (!res.ok) raise(res, fallback)
  return parseJson<T>(res)
}
