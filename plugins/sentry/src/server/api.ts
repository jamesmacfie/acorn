// Sentry's REST API, as far as this plugin reads it. Every call takes the auth token as a bearer, and
// the token never goes into a path, a log line, or an error message.

// The client's node fan-out gives up after 5s, so each call stops at 4s, as Rollbar's do.
const REQUEST_TIMEOUT_MS = 4_000

// The hosts `permissions.node.net` lets the worker reach. The US region answers on the first two, the
// EU region on the third.
const SENTRY_HOSTS: readonly string[] = ['sentry.io', 'us.sentry.io', 'de.sentry.io']
export const DEFAULT_SENTRY_URL = 'https://sentry.io'

/** The host an address names, when it's one of Sentry's that the worker may reach. */
export function sentryHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && SENTRY_HOSTS.includes(parsed.hostname) ? parsed.hostname : null
  } catch {
    return null
  }
}

/** What one call needs: the token and where the project lives. */
export type SentryCredential = { token: string; host: string; organization: string; project: string }

export function sentryFetch(credential: SentryCredential, path: string): Promise<Response> {
  return fetch(`https://${credential.host}/api/0${path}`, {
    headers: { authorization: `Bearer ${credential.token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

const segment = encodeURIComponent

export const projectPath = (credential: SentryCredential) =>
  `/projects/${segment(credential.organization)}/${segment(credential.project)}/`
// The organization's issues endpoint, filtered to one project by its slug. The per-project issues
// endpoint takes the same filter but is deprecated.
export const issuesPath = (credential: SentryCredential) =>
  `/organizations/${segment(credential.organization)}/issues/?project=${segment(credential.project)}&query=${segment('is:unresolved')}&sort=date&limit=100`
export const issuePath = (credential: SentryCredential, issueId: string) =>
  `/organizations/${segment(credential.organization)}/issues/${segment(issueId)}/`
export const latestEventPath = (credential: SentryCredential, issueId: string) =>
  `/organizations/${segment(credential.organization)}/issues/${segment(issueId)}/events/latest/`

export type SentryApiProject = { id: string; slug: string; name?: string }
