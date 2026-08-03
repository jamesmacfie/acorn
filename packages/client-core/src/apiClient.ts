import type { ApiError as ApiErrorBody } from '@acorn/protocol/api.ts'
import type { NodeFetchBody, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { acornGlobal } from './capabilities'
import { activeNodeId } from './node/activeNode'

// The renderer's only HTTP surface. Every request goes through Electron main's connection broker
// (docs/vNext/architecture.md § How the client talks to nodes), which owns the endpoint, the pinned
// certificate and the device token — so nothing here knows an origin and nothing here holds a
// credential.
//
// readJson / writeJson / postJson keep the exact signatures their 213 call sites already use; only
// the innards changed.

// Typed error for non-OK API responses: carries the HTTP status so consumers branch structurally
// (e.g. the node-state machine's 401 handling) instead of pattern-matching message text. `requestId`
// is what makes a user-reported failure findable in the node's log.
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

// What a call site sees. Deliberately not a web Response: a broker reply is already fully buffered,
// and pretending otherwise would invite streaming code that cannot work over IPC.
export type ApiResponse = { ok: boolean; status: number; headers: Record<string, string>; body: Uint8Array }

let requestSeq = 0
const nextRequestId = (): string => `r${++requestSeq}-${Date.now()}`

const decoder = new TextDecoder()

// A string body is accepted and encoded here, because that is what every existing call site passes
// (they used to build a RequestInit). Keeping the ergonomics identical is what made this cutover a
// one-file change rather than a sweep over ~30 mutation helpers.
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
}

// The one place a request leaves the renderer.
async function send(path: string, options: SendOptions = {}): Promise<ApiResponse> {
  const bridge = acornGlobal()
  const nodeFetch = bridge?.nodeFetch
  const nodeId = options.nodeId ?? activeNodeId()

  if (!nodeFetch || !nodeId) {
    // No broker: the renderer is running in a plain browser served directly by a node (`dev:node`),
    // or in a unit test that stubs global fetch. Same-origin, so whatever auth that origin accepts
    // applies — there is no device token on this path by definition.
    const res = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: bodyForFetch(asNodeBody(options.body)),
      signal: options.signal,
    })
    return { ok: res.ok, status: res.status, headers: headersToObject(res.headers), body: new Uint8Array(await res.arrayBuffer()) }
  }

  const requestId = nextRequestId()
  // Abort has to be forwarded explicitly: the AbortSignal itself cannot cross contextBridge, so main
  // holds the controller and the renderer names the request to cancel.
  const onAbort = () => bridge?.nodeAbort?.(requestId)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await nodeFetch(nodeId, {
      requestId,
      path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      ...(asNodeBody(options.body) ? { body: asNodeBody(options.body)! } : {}),
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

// One place that reads the wire envelope (docs/vNext/protocol.md § Errors). A non-JSON or
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

// Prefer the human/upstream prose in `message` (e.g. GitHub's verbatim 422 reason) over the machine
// code — the code is for branching, the message is for people.
const errorText = (error: ApiErrorBody['error'] | undefined, fallback: string): string => error?.message || error?.code || fallback

const raise = (res: ApiResponse, fallback: string): never => {
  const error = errorBody(res)
  throw new ApiError(errorText(error, fallback), res.status, error?.code, {
    requestId: error?.requestId,
    retryable: error?.retryable,
  })
}

type ReadOptions = { signal?: AbortSignal; nodeId?: string }

export async function readJson<T>(url: string, options: ReadOptions = {}): Promise<T> {
  const res = await send(url, { signal: options.signal, nodeId: options.nodeId })
  if (!res.ok) raise(res, `${url} ${res.status}`)
  return parseJson<T>(res)
}

// Reads the error prose out of a failed response. Kept as a separate export because a few call sites
// want the message without the throw.
export async function apiError(res: ApiResponse, fallback: string): Promise<string> {
  return errorText(errorBody(res), fallback)
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
}

// JSON POST. Throws the structured error code on failure so callers can branch (e.g. merge_failed).
export const postJson = async <T>(url: string, body?: unknown, options?: { idempotencyKey?: string }): Promise<T> =>
  writeJson<T>(url, {
    method: 'POST',
    headers: {
      ...(body === undefined ? {} : JSON_HEADERS),
      // Minted by the CALLER, never by the broker: only the call site knows that a retry is the same
      // logical mutation, and a broker-minted key would defeat replay entirely
      // (docs/vNext/protocol.md § HTTP conventions).
      ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

// For endpoints that answer 204/empty. readJson/writeJson always parse a body, which is the only
// reason a handful of call sites used to reach past this module to raw fetch.
export async function sendJson<T = void>(url: string, init: WriteInit, fallback: ErrorFallback = (res) => `${res.status}`): Promise<T> {
  const res = await send(url, init)
  if (!res.ok) raise(res, typeof fallback === 'function' ? fallback(res) : fallback)
  return parseJson<T>(res)
}

// Multipart upload. The parts are described, not encoded: main builds the real body, so the renderer
// never has to hand-roll a boundary.
export async function sendForm<T>(url: string, parts: Extract<NodeFetchBody, { kind: 'form' }>['parts'], fallback = 'upload failed'): Promise<T> {
  const res = await send(url, { method: 'POST', body: { kind: 'form', parts } })
  if (!res.ok) raise(res, fallback)
  return parseJson<T>(res)
}
