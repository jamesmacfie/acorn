// Typed error for non-OK API responses: carries the HTTP status so consumers branch structurally
// (e.g. index.tsx's 401 → reauth bounce) instead of pattern-matching message text.
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ReadOptions = { nullOn401?: boolean; signal?: AbortSignal }

export async function readJson<T>(url: string, options: ReadOptions = {}): Promise<T> {
  const res = await fetch(url, { signal: options.signal })
  if (options.nullOn401 && res.status === 401) return null as T
  if (!res.ok) throw new ApiError(`${url} ${res.status}`, res.status)
  return res.json()
}

export async function apiError(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  return err.error ?? fallback
}

type ErrorFallback = string | ((res: Response) => string)

export async function writeJson<T>(url: string, init: RequestInit, fallback: ErrorFallback = (res) => `${res.status}`): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new ApiError(await apiError(res, typeof fallback === 'function' ? fallback(res) : fallback), res.status)
  return res.json()
}
