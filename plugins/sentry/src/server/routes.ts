import { Hono, type Context } from 'hono'
import {
  type AppEnv,
  type CoreServices,
  type PluginFetchHandler,
  portableCarrier,
  respondError,
  type RouteFailure,
} from '@acorn/plugin-api/node'
import { ENV_CONNECTION_ID, type SentryIssueSummary } from '../shared/api'
import { sentryRailItem } from '../shared/rail'
import { issuePath, issuesPath, latestEventPath, sentryFetch } from './api'
import { connectionConfig, type SentryTarget } from './credentials'
import { composeIssueDetail, normalizeEvent, normalizeIssue } from './normalize'
import { sentrySearchItems } from './paletteSearch'

const PROVIDER = 'sentry'

const { requestContext, portableFetch } = portableCarrier(PROVIDER)

type ProjectScope = Pick<CoreServices['projects'], 'byId' | 'externalProjects'>
type ConnectionRow = { id: string; label: string; config: string }

/**
 * Run `visit` once for each credential `wanted` admits, with the token lent for that call only.
 *
 * Any connection in Settings wins, so the environment's credential is used only while there's none at
 * all (docs/integrations/sentry.md § Credentials from the environment).
 */
async function eachTarget<T>(
  c: Context<AppEnv>,
  environment: SentryTarget | null,
  wanted: (connectionId: string) => boolean,
  visit: (target: SentryTarget) => Promise<T>,
): Promise<T[]> {
  const providers = requestContext(c).providers
  if ((await providers.connections(PROVIDER)).length === 0) {
    return environment && wanted(environment.connectionId) ? [await visit(environment)] : []
  }
  return providers.withConnections(PROVIDER, async (connection, token) => {
    const row = connection as ConnectionRow
    const config = connectionConfig(row.config)
    if (!config || !wanted(row.id)) return undefined
    return visit({ connectionId: row.id, label: row.label, token, ...config })
  })
}

/**
 * Which connections the routed project follows, read from its workspace's map, as Rollbar's rail
 * reads it. The environment's credential has no row, so the map can't hold it, and it follows every
 * project. No project means nothing, so a stale client with no `?project=` sees no rows.
 */
async function railScope(
  projectId: string | undefined,
  projects: ProjectScope | undefined,
): Promise<((connectionId: string) => boolean) | null> {
  if (!projectId || !projects) return null
  const project = await projects.byId(projectId)
  if (!project) return null
  const rows = await projects.externalProjects(project.workspaceId)
  const mapped = new Set(
    rows.filter((row) => !row.projectId || row.projectId === projectId).map((row) => row.connectionId),
  )
  return (connectionId) => connectionId === ENV_CONNECTION_ID || mapped.has(connectionId)
}

// A plain sentence rides along as the failure's detail, because the rail draws a failed route's
// message as it is. It names the credential by its label, never its token.
function failureFor(response: Response, target: SentryTarget): RouteFailure | null {
  if (response.ok) return null
  if (response.status === 401 || response.status === 403) {
    return {
      error: 'provider_needs_auth',
      status: 401,
      detail: [`Sentry turned down the token for ${target.label}. It needs event:read.`],
    }
  }
  if (response.status === 404) {
    return { error: 'provider_resource_not_found', status: 404, detail: ["Sentry can't find this issue."] }
  }
  if (response.status === 429) {
    return {
      error: 'provider_rate_limited',
      status: 429,
      detail: ['Sentry is limiting requests. Try again in a minute.'],
    }
  }
  return unavailable(target)
}

const unavailable = (target: SentryTarget): RouteFailure => ({
  error: 'provider_unavailable',
  status: 502,
  detail: [`Sentry didn't answer for ${target.label}. Try again.`],
})

type Answer<T> = { ok: true; value: T } | { ok: false; failure: RouteFailure }

async function readJson(target: SentryTarget, path: string): Promise<Answer<unknown>> {
  try {
    const response = await sentryFetch(target, path)
    const failure = failureFor(response, target)
    return failure ? { ok: false, failure } : { ok: true, value: await response.json() }
  } catch {
    return { ok: false, failure: unavailable(target) }
  }
}

async function listIssues(target: SentryTarget): Promise<Answer<SentryIssueSummary[]>> {
  const answer = await readJson(target, issuesPath(target))
  if (!answer.ok) return answer
  const raw = Array.isArray(answer.value) ? answer.value : []
  return {
    ok: true,
    value: raw.flatMap((issue) => normalizeIssue(target.connectionId, target.label, issue) ?? []),
  }
}

const fail = (c: Context<AppEnv>, failure: RouteFailure) =>
  respondError(c, failure.status, failure.error, failure.detail)

const createSentryRoutes = (environment: SentryTarget | null, projects?: ProjectScope) => {
  // The routed project's unresolved issues, newest first. One credential failing keeps the rows another
  // returned. Only a total failure is an error.
  const scopedIssues = async (
    c: Context<AppEnv>,
    projectId: string | undefined,
  ): Promise<Answer<SentryIssueSummary[]>> => {
    const wanted = await railScope(projectId, projects)
    if (!wanted) return { ok: true, value: [] }
    const answers = await eachTarget(c, environment, wanted, listIssues)
    const failures = answers.flatMap((answer) => (answer.ok ? [] : [answer.failure]))
    if (failures.length && failures.length === answers.length) return { ok: false, failure: failures[0]! }
    const issues = answers.flatMap((answer) => (answer.ok ? answer.value : []))
    issues.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    return { ok: true, value: issues }
  }

  return (
    new Hono<AppEnv>()
      .get('/rail-items', async (c) => {
        const answer = await scopedIssues(c, c.req.query('project'))
        return answer.ok ? c.json({ items: answer.value.map(sentryRailItem) }) : fail(c, answer.failure)
      })
      // The `Find a Sentry issue` command's rows. The palette sends the routed project as `projectId`.
      // Sentry is read live, as the rail is, and the typed text only filters what comes back.
      .get('/palette/issues', async (c) => {
        const answer = await scopedIssues(c, c.req.query('projectId'))
        return answer.ok
          ? c.json({ items: sentrySearchItems(answer.value, c.req.query('q') ?? '') })
          : fail(c, answer.failure)
      })
      // The issue and its latest event. An issue whose event can't be read is still drawn without it.
      .get('/issues/:issue', async (c) => {
        const connectionId = c.req.query('connection')
        if (!connectionId) return respondError(c, 400, 'bad_request')
        const issueId = c.req.param('issue')
        const [answer] = await eachTarget(
          c,
          environment,
          (id) => id === connectionId,
          async (target) => {
            const [issue, event] = await Promise.all([
              readJson(target, issuePath(target, issueId)),
              readJson(target, latestEventPath(target, issueId)),
            ])
            if (!issue.ok) return issue
            const summary = normalizeIssue(target.connectionId, target.label, issue.value)
            if (!summary) return { ok: false, failure: unavailable(target) } as const
            return {
              ok: true,
              value: composeIssueDetail(summary, event.ok ? normalizeEvent(event.value) : null),
            } as const
          },
        )
        if (!answer) return respondError(c, 403, 'provider_not_connected')
        return answer.ok ? c.json(answer.value) : fail(c, answer.failure)
      })
  )
}

/**
 * The plugin's routes over the portable carrier. `environment` is the credential read from the
 * worker's environment at start, or null. `projects` is optional for suites that drive the routes
 * without a project scope.
 */
export const createSentryFetch = (environment: SentryTarget | null, projects?: ProjectScope): PluginFetchHandler =>
  portableFetch(createSentryRoutes(environment, projects))
