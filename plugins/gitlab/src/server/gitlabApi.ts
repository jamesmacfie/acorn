import type { Context } from 'hono'
import {
  type AppEnv,
  providerCredential,
  refreshProviderCredential,
  type RouteFailure,
  type RouteResult,
} from '@acorn/plugin-api/node'
import { GITLAB_PROVIDER } from './config'
import type { GitlabServer } from './servers'

export { GITLAB_PROVIDER }

// Every call out to GitLab needs a deadline shorter than the client's 5 seconds, for the reason
// GitHub's client gives (`REQUEST_TIMEOUT_MS` in plugins/github/src/server/githubApi.ts). A caller's own
// signal wins, because a data source read brings its run's budget.
const REQUEST_TIMEOUT_MS = 4_000

/**
 * The server to call, a credential for it, and the way to renew that. An access token from the device
 * flow lasts two hours. The host renews it before it expires, and `refresh` is for a `401` that comes
 * first: the call is retried once with the renewed token. A personal access token and a background read
 * have no `refresh`.
 */
export type GitlabSession = { origin: string; token: string; refresh?: () => Promise<string> }

/** The owner's credential for a route, on the connection that serves `server`. An empty token means
 *  that connection is gone or can't be used. */
export const gitlabSession = async (c: Context<AppEnv>, server: GitlabServer): Promise<GitlabSession> => ({
  origin: server.origin,
  token: await providerCredential(c, GITLAB_PROVIDER, server.connectionId),
  refresh: () => refreshProviderCredential(c, GITLAB_PROVIDER, server.connectionId),
})

// No credential answers the way GitLab would, so "never connected" and "revoked" both reach the
// client's reconnect path.
const notConnected = (): Response =>
  new Response(JSON.stringify({ message: 'GitLab is not connected' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

async function call(session: GitlabSession, url: string, init: RequestInit = {}): Promise<Response> {
  if (!session.token) return notConnected()
  const send = (token: string) =>
    fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  const response = await send(session.token)
  if (response.status !== 401 || !session.refresh) return response
  const renewed = await session.refresh()
  if (!renewed || renewed === session.token) return response
  session.token = renewed
  return send(renewed)
}

/** REST, under `/api/v4`. `path` starts with `/`. */
export const gl = (session: GitlabSession, path: string, init?: RequestInit) =>
  call(session, `${session.origin}/api/v4${path}`, init)

/** A project's id in a REST path: GitLab takes the URL-encoded full path in its place. */
export const projectRef = (path: string) => encodeURIComponent(path)

// A non-OK GitLab answer as the client's error code and a status, or null for a 2xx.
export const glError = (response: Response): RouteFailure | null => {
  if (response.ok) return null
  if (response.status === 401) return { error: 'reauth', status: 401 }
  if (response.status === 403) return { error: 'forbidden', status: 403 }
  if (response.status === 404) return { error: 'not_found', status: 404 }
  if (response.status === 429) return { error: 'rate_limited', status: 429 }
  return { error: 'gitlab_unavailable', status: 502 }
}

/** A REST read parsed as JSON, or the failure. */
export async function glJson<T>(session: GitlabSession, path: string, init?: RequestInit): Promise<RouteResult<T>> {
  const response = await gl(session, path, init)
  const failure = glError(response)
  if (failure) return { ok: false, failure: { ...failure, detail: await messages(response) } }
  return { ok: true, value: (await response.json()) as T }
}

// GitLab's own words for a refused write, such as "Branch cannot be merged", for the person to read.
async function messages(response: Response): Promise<string[] | undefined> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown } | null
  const message = body?.message ?? body?.error
  if (typeof message === 'string') return [message]
  if (Array.isArray(message)) return message.filter((item): item is string => typeof item === 'string')
  if (message && typeof message === 'object')
    return Object.entries(message).map(([field, value]) => `${field} ${String(value)}`)
  return undefined
}

/** GraphQL. A 200 that carries `errors` is a failure with GitLab's messages. */
export async function glGraphQL<T>(
  session: GitlabSession,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<RouteResult<T>> {
  const response = await call(session, `${session.origin}/api/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    ...(signal ? { signal } : {}),
  })
  const failure = glError(response)
  if (failure) return { ok: false, failure }
  const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] }
  if (body.errors?.length)
    return {
      ok: false,
      failure: {
        error: 'gitlab_unavailable',
        status: 502,
        detail: body.errors.map((error) => error.message ?? 'GraphQL error'),
      },
    }
  return { ok: true, value: body.data as T }
}

/** The numeric id at the end of a GraphQL global id, such as `gid://gitlab/Ci::Build/42`. */
export const gidNumber = (gid: string): number => Number(gid.slice(gid.lastIndexOf('/') + 1))

/** The id at the end of a GraphQL global id, such as a discussion's sha. */
export const gidTail = (gid: string): string => gid.slice(gid.lastIndexOf('/') + 1)
