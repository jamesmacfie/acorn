import type { Context } from 'hono'
import { type AppEnv, providerCredential, type RouteFailure, type RouteResult } from '@acorn/plugin-api/node'
import { BITBUCKET_PROVIDER } from './config'

export { BITBUCKET_PROVIDER }

const API_ORIGIN = 'https://api.bitbucket.org'

// Every call out to Bitbucket needs a deadline shorter than the client's 5 seconds, for the reason
// GitHub's client gives (`REQUEST_TIMEOUT_MS` in plugins/github/src/server/githubApi.ts). A caller's own
// signal wins, because a data source read brings its run's budget.
const REQUEST_TIMEOUT_MS = 4_000

/**
 * A credential for Bitbucket's REST API: the Atlassian email and API token the connection stores as one
 * secret, `email:token`, sent as basic auth. An API token doesn't expire on a clock and can't be
 * renewed, so a session has no refresh.
 */
export type BitbucketSession = { auth: string }

/** The owner's credential for a route. An empty one means Bitbucket isn't connected. */
export const bitbucketSession = async (c: Context<AppEnv>, connectionId: string): Promise<BitbucketSession> => ({
  auth: await providerCredential(c, BITBUCKET_PROVIDER, connectionId),
})

// No credential answers the way Bitbucket would, so "never connected" and "revoked" both reach the
// client's reconnect path.
const notConnected = (): Response =>
  new Response(JSON.stringify({ type: 'error', error: { message: 'Bitbucket is not connected' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

/** A REST call under `/2.0`. `path` starts with `/`, or is a `next` page address Bitbucket sent. */
export function bb(session: BitbucketSession, path: string, init: RequestInit = {}): Promise<Response> {
  if (!session.auth) return Promise.resolve(notConnected())
  // A page link is followed only on the API's own origin, so an answer can't send the credential
  // elsewhere.
  const url = path.startsWith('/') ? `${API_ORIGIN}/2.0${path}` : path
  if (!url.startsWith(`${API_ORIGIN}/`)) return Promise.resolve(new Response(null, { status: 502 }))
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(session.auth).toString('base64')}`,
      Accept: 'application/json',
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/** A repository's REST path, `/repositories/workspace/repo`. */
export const repositoryPath = (repository: string) => `/repositories/${repository}`

// A non-OK Bitbucket answer as the client's error code and a status, or null for a 2xx.
export const bbError = (response: Response): RouteFailure | null => {
  if (response.ok) return null
  if (response.status === 401) return { error: 'reauth', status: 401 }
  if (response.status === 403) return { error: 'forbidden', status: 403 }
  if (response.status === 404) return { error: 'not_found', status: 404 }
  if (response.status === 429) return { error: 'rate_limited', status: 429 }
  return { error: 'bitbucket_unavailable', status: 502 }
}

/** Bitbucket's own words for a refusal, such as "You can't merge until you resolve all merge
 *  conflicts.", for the person to read. Bitbucket answers `{ type: 'error', error: { message } }`. */
export async function bitbucketMessage(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null
  const message = body?.error?.message
  return typeof message === 'string' && message.trim() ? message.trim() : undefined
}

/** A REST call parsed as JSON, or the failure with Bitbucket's message. An empty 2xx is `null`. */
export async function bbJson<T>(session: BitbucketSession, path: string, init?: RequestInit): Promise<RouteResult<T>> {
  const response = await bb(session, path, init)
  const failure = bbError(response)
  if (failure) {
    const message = await bitbucketMessage(response)
    return { ok: false, failure: { ...failure, ...(message ? { detail: [message] } : {}) } }
  }
  const text = await response.text()
  return { ok: true, value: (text ? JSON.parse(text) : null) as T }
}

type Page<T> = { values: T[]; next?: string }

/** Up to `maxPages` pages of a paginated list, following each `next`. `capped` says Bitbucket had
 *  more. */
export async function bbPages<T>(
  session: BitbucketSession,
  path: string,
  maxPages: number,
  signal?: AbortSignal,
): Promise<RouteResult<{ values: T[]; capped: boolean }>> {
  const values: T[] = []
  let next: string | undefined = path
  for (let page = 0; page < maxPages && next; page++) {
    const answer: RouteResult<Page<T>> = await bbJson<Page<T>>(session, next, signal ? { signal } : undefined)
    if (!answer.ok) return answer
    values.push(...answer.value.values)
    next = answer.value.next
  }
  return { ok: true, value: { values, capped: !!next } }
}

/** A JSON request body. */
export const send = (method: 'POST' | 'PUT' | 'DELETE', body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
})
