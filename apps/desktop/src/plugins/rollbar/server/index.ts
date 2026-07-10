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
}

// Rollbar's items API reports level as a number on some plans; normalise to the word.
const LEVELS: Record<number, string> = { 10: 'debug', 20: 'info', 30: 'warning', 40: 'error', 50: 'critical' }
export const levelName = (level: string | number): string => (typeof level === 'number' ? (LEVELS[level] ?? String(level)) : level)

export const projectPath = '/project'
export const itemsPath = '/items?status=active'
export const itemByCounterPath = (counter: string) => `/item_by_counter/${encodeURIComponent(counter)}`
