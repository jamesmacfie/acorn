// Rollbar REST client (docs/integrations.md) — the thin sibling of server/linear/. A connection is a
// project-read access token; items are Rollbar's deduped errors, identified in acorn by their
// visible `counter` (#142). Exported fetch is mocked in route tests; never called live there.

const BASE = 'https://api.rollbar.com/api/1'

export function rollbarFetch(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { 'X-Rollbar-Access-Token': token, accept: 'application/json' } })
}

// Rollbar wraps everything as { err: 0, result } — err != 0 or HTTP failure is an API error.
export async function rollbarData<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`rollbar ${res.status}`)
  const body = (await res.json()) as { err?: number; message?: string; result?: T }
  if (body.err) throw new Error(body.message ?? `rollbar err ${body.err}`)
  if (body.result === undefined) throw new Error('rollbar: empty result')
  return body.result
}

export type RollbarProject = { id: number; name: string }

// Upstream shapes are deliberately loose: Rollbar's reference documents endpoints more reliably than
// response schemas, and fields are plan-dependent. Everything beyond the identifiers is optional and
// guarded during normalization (server/normalize.ts). NOTE: authored from Rollbar's public API docs,
// not a live contract spike — the normalizer treats every field as possibly absent or mistyped.
export type RollbarApiItem = {
  id: number
  counter: number
  title: string
  level: string | number
  environment: string
  status: string
  total_occurrences: number
  first_occurrence_timestamp: number
  last_occurrence_timestamp: number
  framework?: string | null
  last_occurrence_id?: number | null
  resolved_in_version?: string | null
  assigned_user_id?: number | string | null
}

// GET /instance/:id → { result: { id, occurrence, ... } }. The occurrence body is the notifier
// payload; only the allowlisted fields below are read, never persisted wholesale.
export type RollbarApiInstance = {
  id?: number | string
  timestamp?: number | null
  occurrence?: Record<string, unknown> | null
}

export type RollbarApiInstancesPage = { instances?: RollbarApiInstance[] }

// Rollbar's items API reports level as a number on some plans; normalise to the word.
const LEVELS: Record<number, string> = { 10: 'debug', 20: 'info', 30: 'warning', 40: 'error', 50: 'critical' }
export const levelName = (level: string | number): string => (typeof level === 'number' ? (LEVELS[level] ?? String(level)) : level)

export const projectPath = '/project'
export const itemsPath = (page: number) => `/items?status=active&page=${page}`
export const itemByCounterPath = (counter: string) => `/item_by_counter/${encodeURIComponent(counter)}`
export const itemByIdPath = (itemId: string) => `/item/${encodeURIComponent(itemId)}`
export const itemInstancesPath = (itemId: string, limit: number) => `/item/${encodeURIComponent(itemId)}/instances?limit=${limit}`
export const instancePath = (occurrenceId: string) => `/instance/${encodeURIComponent(occurrenceId)}`
