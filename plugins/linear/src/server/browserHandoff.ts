import {
  truncateBytes,
  type CoreServices,
  type PluginFetchHandler,
  type RouteFailure,
  type StoredConnection,
} from '@acorn/plugin-api/node'
import { connectionName } from '@acorn/protocol/integrations.ts'
import type { BrowserHandoffItem, BrowserHandoffResolution } from '@acorn/protocol/plugin/handoffs.ts'
import type { LinearIssueDetail } from '../shared/api'
import { linearTaskFields } from '../shared/rail'
import { linearTeamScopeId, parseIdentifier } from '.'
import { LINEAR_ISSUES_RESOURCE, type LinearResourceInput } from './provider'

// The route behind the issue button the browser extension draws on linear.app
// (docs/integrations/linear.md § Browser handoff). The manifest declares the button. The extension
// matches the page; this route reads the issue through the same mirrored resource the detail pane
// uses, once per Linear connection, and says which projects the workspace mappings tie it to.

const PROVIDER = 'linear'

// The issue description is the author's text. The agent reads it inside the extension's context block,
// which marks it as captured material; this keeps it to a size worth reading in a draft.
const DESCRIPTION_MAX_BYTES = 8_000

export function createBrowserHandoffHandler(dependencies: {
  // Acorn projects whose workspace maps one of these Linear scopes on this connection.
  projectsFor(connectionId: string, scopeIds: string[]): Promise<string[]>
}): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    const body = (await request.json().catch(() => null)) as { captures?: Record<string, unknown> } | null
    const workspace = text(body?.captures?.workspace).toLowerCase()
    const identifier = text(body?.captures?.identifier).toUpperCase()
    if (!workspace || !parseIdentifier(identifier))
      return refusal(400, 'bad_request', 'That address is not a Linear issue.')

    const connections = (await context.providers.connections(PROVIDER)).filter(
      (connection) => connection.status !== 'disabled',
    )
    if (!connections.length)
      return refusal(403, 'provider_not_connected', 'Connect Linear in Acorn to open issues from the browser.')

    // Every connection is asked, rather than the first that answers, because two workspaces can both
    // have an ENG-42. A fresh read, so a deleted issue or a revoked key isn't hidden by the cache.
    const reads = await Promise.all(
      connections.map(async (connection) => ({
        connection,
        read: await context.providers.resource<LinearResourceInput, LinearIssueDetail>({
          providerId: PROVIDER,
          connectionId: connection.id,
          resourceId: LINEAR_ISSUES_RESOURCE,
          input: { kind: 'detail', identifier },
          force: true,
          requireFresh: true,
        }),
      })),
    )

    const items: BrowserHandoffItem[] = []
    const failures: { connection: StoredConnection; failure: RouteFailure }[] = []
    for (const { connection, read } of reads) {
      if (!read.ok) {
        // Not in this workspace is what every connection but one answers.
        if (read.failure.status !== 404) failures.push({ connection, failure: read.failure })
        continue
      }
      // The team prefix alone doesn't name an issue. Linear's own address for it says which workspace
      // it is in, and that has to be the page's.
      if (issueWorkspace(read.value.url) !== workspace) continue
      items.push(await handoffItem(connection, read.value, dependencies.projectsFor))
    }
    // A workspace that answered is a real answer even when another failed, as on the rail.
    if (items.length) return Response.json({ items: items.slice(0, 8) } satisfies BrowserHandoffResolution)
    if (failures.length) return failureRefusal(failures)
    return refusal(
      404,
      'not_found',
      `No connected Linear workspace can show ${identifier} in ${workspace}. It may have been deleted, or be in a workspace Acorn isn't connected to.`,
    )
  }
}

async function handoffItem(
  connection: StoredConnection,
  issue: LinearIssueDetail,
  projectsFor: (connectionId: string, scopeIds: string[]) => Promise<string[]>,
): Promise<BrowserHandoffItem> {
  const scopeIds = [
    ...(issue.project ? [issue.project.id] : []),
    ...(issue.team?.id ? [linearTeamScopeId(issue.team.id)] : []),
  ]
  const fields = linearTaskFields(issue)
  return {
    identifier: issue.identifier,
    url: issue.url,
    title: issue.title.slice(0, 300) || issue.identifier,
    connection: { id: connection.id, label: connectionName(connection) },
    projects: scopeIds.length ? (await projectsFor(connection.id, scopeIds)).slice(0, 16) : [],
    // The rail's promotion seed, with the issue as a connection-stamped link: that link is how a task
    // already holding this issue is found, in any project.
    seed: {
      ...fields,
      title: fields.title.slice(0, 300),
      links: [
        {
          connectionId: connection.id,
          identifier: issue.identifier,
          ref: { displayId: issue.identifier, url: issue.url },
        },
      ],
    },
    context: { label: `Linear issue ${issue.identifier}`, content: issueContext(issue) },
  }
}

// The workspace's URL key, from Linear's own address for the issue.
function issueWorkspace(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'linear.app' ? (parsed.pathname.split('/')[1]?.toLowerCase() ?? null) : null
  } catch {
    return null
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// Never 401: the extension's host reads a 401 as the Node refusing the browser itself.
const refusal = (status: 400 | 403 | 404 | 429 | 502, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// The failure the person can act on first: a key to reconnect, then a limit to wait out.
function failureRefusal(failures: { connection: StoredConnection; failure: RouteFailure }[]): Response {
  const needsAuth = failures.find(({ failure }) => failure.status === 401)
  if (needsAuth)
    return refusal(
      403,
      'provider_needs_auth',
      `Linear didn't accept the saved key for ${connectionName(needsAuth.connection)}. Reconnect it in Acorn's settings.`,
    )
  if (failures.some(({ failure }) => failure.status === 429))
    return refusal(429, 'provider_rate_limited', 'Linear is limiting requests right now. Try again in a minute.')
  return refusal(502, 'provider_unavailable', "Linear didn't answer. Try again shortly.")
}

function issueContext(issue: LinearIssueDetail): string {
  const status = [
    issue.state ? `State: ${issue.state.name}` : '',
    issue.assignee ? `assigned to ${issue.assignee}` : 'unassigned',
    issue.priorityLabel ? `priority ${issue.priorityLabel}` : '',
  ].filter(Boolean)
  const lines = [`${issue.identifier}: ${issue.title}`, issue.url, status.join(' · ')]
  const place = [issue.team ? `Team: ${issue.team.name}` : '', issue.project ? `Project: ${issue.project.name}` : '']
  if (place.some(Boolean)) lines.push(place.filter(Boolean).join(' · '))
  if (issue.labels?.length) lines.push(`Labels: ${issue.labels.map((label) => label.name).join(', ')}`)
  const description = issue.description?.trim()
  if (description) lines.push('', truncateBytes(description, DESCRIPTION_MAX_BYTES))
  return lines.join('\n')
}

type ProjectReads = Pick<CoreServices['projects'], 'checkouts' | 'byId' | 'externalProjects'>

// Projects a workspace mapping ties the issue to: a mapping on this connection of the issue's Linear
// project or its team, covering the whole Acorn workspace or naming the project. The same rule the
// rail's list uses, read the other way. Nothing is guessed from the address's workspace key, and a
// project with no folder on disk isn't offered, as with GitHub's handoff.
export async function projectsMappingIssue(
  projects: ProjectReads,
  connectionId: string,
  scopeIds: string[],
): Promise<string[]> {
  const refs = await Promise.all((await projects.checkouts()).map((checkout) => projects.byId(checkout.id)))
  const mappings = new Map<string, ReturnType<ProjectReads['externalProjects']>>()
  const found: string[] = []
  for (const ref of refs) {
    if (!ref) continue
    if (!mappings.has(ref.workspaceId)) mappings.set(ref.workspaceId, projects.externalProjects(ref.workspaceId))
    const rows = await mappings.get(ref.workspaceId)!
    if (
      rows.some(
        (row) =>
          row.connectionId === connectionId &&
          scopeIds.includes(row.externalId) &&
          (!row.projectId || row.projectId === ref.id),
      )
    )
      found.push(ref.id)
  }
  return found
}
