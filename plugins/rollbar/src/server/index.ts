// Rollbar REST client, structured like server/linear/ (docs/integrations.md § Rollbar covers the
// connection model). Items are Rollbar's deduped errors, identified in acorn by their visible
// `counter` (#142) rather than their internal id. Exported fetch is mocked in route tests, never
// called live there.

// Every call out to a provider needs a deadline shorter than the client's. The fan-out gives a node 5s
// (client-core/src/infra/node/fanout.ts) and then draws "unavailable" over the whole node, so a fetch
// that outlasts it reads to the user as "your machine is down" rather than "this API is slow". Eight
// seconds did exactly that: the client always gave up first, so the "this provider is unavailable"
// answer below could never reach anyone. Four, which is what core's own provider routes allow
// themselves against the same deadline (node-core server/routes/nodeProviders.ts).
// ponytail: per-request, not per-route. A route that loops over several connections can still add up
// past the client's 5s; give it a shared budget if anyone hits that with enough workspaces.
const REQUEST_TIMEOUT_MS = 4_000

const BASE = 'https://api.rollbar.com/api/1'

export function rollbarFetch(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { 'X-Rollbar-Access-Token': token, accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

// Rollbar wraps every response as { err: 0, result }. A nonzero err or an HTTP failure counts as an
// API error.
export async function rollbarData<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`rollbar ${res.status}`)
  const body = (await res.json()) as { err?: number; message?: string; result?: T }
  if (body.err) throw new Error(body.message ?? `rollbar err ${body.err}`)
  if (body.result === undefined) throw new Error('rollbar: empty result')
  return body.result
}

export type RollbarProject = { id: number; name: string }

// Upstream shapes stay loose. Rollbar's reference documents endpoints more reliably than response
// schemas, and fields vary by plan. This type comes from those docs, not from a live contract spike,
// so everything beyond the identifiers is optional and server/normalize.ts treats every field as
// possibly absent or mistyped.
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
  last_activated_timestamp?: number | null
  unique_occurrences?: number | null
  resolved_in_version?: string | null
  assigned_user_id?: number | string | null
}

// GET /instance/:id and /item/:id/instances expose the notifier payload as `data`. `occurrence` is a
// compatibility alias for older fixtures. Only allowlisted fields are read, and neither upstream
// object is persisted whole.
export type RollbarApiInstance = {
  id?: number | string
  timestamp?: number | null
  data?: Record<string, unknown> | null
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
export const itemInstancesPath = (itemId: string, limit: number) =>
  `/item/${encodeURIComponent(itemId)}/instances?limit=${limit}`
export const instancePath = (occurrenceId: string) => `/instance/${encodeURIComponent(occurrenceId)}`
