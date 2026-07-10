import type { ApiError as ApiErrorBody } from '../shared/api'

// Typed error for non-OK API responses: carries the HTTP status so consumers branch structurally
// (e.g. index.tsx's 401 → reauth bounce) instead of pattern-matching message text.
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type ReadOptions = { nullOn401?: boolean; signal?: AbortSignal }

export async function readJson<T>(url: string, options: ReadOptions = {}): Promise<T> {
  const res = await fetch(url, { signal: options.signal })
  if (options.nullOn401 && res.status === 401) return null as T
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>
    throw new ApiError(body.detail?.join('\n') || body.error || `${url} ${res.status}`, res.status, body.error)
  }
  return res.json()
}

export async function apiError(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>
  // Prefer the human/upstream prose in `detail` (e.g. GitHub's verbatim 422 reason) over the
  // machine code in `error` — the code is for branching, the detail is for people.
  if (err.detail?.length) return err.detail.join('\n')
  return err.error ?? fallback
}

type ErrorFallback = string | ((res: Response) => string)

export async function writeJson<T>(url: string, init: RequestInit, fallback: ErrorFallback = (res) => `${res.status}`): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>
    const message = body.detail?.join('\n') || body.error || (typeof fallback === 'function' ? fallback(res) : fallback)
    throw new ApiError(message, res.status, body.error)
  }
  return res.json()
}
