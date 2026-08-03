import type { ApiError as ApiErrorBody } from '@acorn/protocol/api.ts'

// Typed error for non-OK API responses: carries the HTTP status so consumers branch structurally
// (e.g. index.tsx's 401 → reauth bounce) instead of pattern-matching message text. `requestId` is
// what makes a user-reported failure findable in the node's log.
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

// One place that reads the wire envelope (docs/vNext/protocol.md § Errors). A non-JSON or
// pre-envelope body degrades to `undefined` rather than throwing over the original failure.
async function errorBody(res: Response): Promise<ApiErrorBody['error'] | undefined> {
  const body = (await res.json().catch(() => undefined)) as Partial<ApiErrorBody> | undefined
  const error = body?.error
  return error && typeof error === 'object' && typeof error.code === 'string' ? error : undefined
}

// Prefer the human/upstream prose in `message` (e.g. GitHub's verbatim 422 reason) over the machine
// code — the code is for branching, the message is for people.
const errorText = (error: ApiErrorBody['error'] | undefined, fallback: string): string =>
  error?.message || error?.code || fallback

const errorMeta = (error: ApiErrorBody['error'] | undefined) => ({
  requestId: error?.requestId,
  retryable: error?.retryable,
})

type ReadOptions = { nullOn401?: boolean; signal?: AbortSignal }

export async function readJson<T>(url: string, options: ReadOptions = {}): Promise<T> {
  const res = await fetch(url, { signal: options.signal })
  if (options.nullOn401 && res.status === 401) return null as T
  if (!res.ok) {
    const error = await errorBody(res)
    throw new ApiError(errorText(error, `${url} ${res.status}`), res.status, error?.code, errorMeta(error))
  }
  return res.json()
}

export async function apiError(res: Response, fallback: string): Promise<string> {
  return errorText(await errorBody(res), fallback)
}

type ErrorFallback = string | ((res: Response) => string)

export async function writeJson<T>(url: string, init: RequestInit, fallback: ErrorFallback = (res) => `${res.status}`): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const error = await errorBody(res)
    const message = errorText(error, typeof fallback === 'function' ? fallback(res) : fallback)
    throw new ApiError(message, res.status, error?.code, errorMeta(error))
  }
  return res.json()
}

// Same-origin JSON POST (cookie auth; the server's csrf() checks Origin). Throws the structured
// error code on failure so callers can branch (e.g. merge_failed, reauth). Every write surface
// shares this rather than re-declaring it.
export const postJson = async <T>(url: string, body?: unknown): Promise<T> =>
  writeJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
