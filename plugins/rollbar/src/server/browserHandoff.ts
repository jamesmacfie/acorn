import {
  truncateBytes,
  type CoreServices,
  type PluginFetchHandler,
  type PluginRequestContext,
  type RouteFailure,
  type StoredConnection,
} from '@acorn/plugin-api/node'
import { connectionName } from '@acorn/protocol/integrations.ts'
import type { BrowserHandoffItem, BrowserHandoffResolution } from '@acorn/protocol/plugin/handoffs.ts'
import type { RollbarItemMetadata, RollbarOccurrenceDetail, RollbarOccurrencesResponse } from '../shared/api'
import { rollbarTaskFields } from '../shared/rail'
import { ROLLBAR_ITEMS_RESOURCE, type RollbarResourceInput } from './provider'
import {
  ROLLBAR_OCCURRENCES_RESOURCE,
  ROLLBAR_OCCURRENCE_RESOURCE,
  type RollbarOccurrenceInput,
  type RollbarOccurrencesInput,
} from './occurrenceResources'

// The route behind the item handoff the browser extension offers on a Rollbar item's permalink
// (docs/integrations/rollbar.md § Browser handoff). The manifest declares it. The page names an item by
// Rollbar's system-wide id; this route asks every connection for that id through the items resource,
// and each connection that can read it answers with the item's own project counter.

const PROVIDER = 'rollbar'

// The context is read by an agent from the person's draft. 12 KB keeps a long trace to a size worth
// reading, under the extension's 16,000-character limit.
const CONTEXT_MAX_BYTES = 12_000
// Source lines are shown for the frame that raised, which is where an investigation starts.
const CODE_FRAMES = 1

export function createBrowserHandoffHandler(dependencies: {
  // Acorn projects whose workspace maps this Rollbar connection.
  projectsFor(connectionId: string): Promise<string[]>
}): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    const body = (await request.json().catch(() => null)) as { captures?: Record<string, unknown> } | null
    const itemId = typeof body?.captures?.itemId === 'string' ? body.captures.itemId : ''
    if (!/^\d{1,20}$/.test(itemId)) return refusal(400, 'bad_request', 'That address is not a Rollbar item.')

    const connections = (await context.providers.connections(PROVIDER)).filter(
      (connection) => connection.status !== 'disabled',
    )
    if (!connections.length)
      return refusal(403, 'provider_not_connected', 'Connect Rollbar in Acorn to open items from the browser.')

    // A Rollbar connection is one project, and the item is in at most one of them, so every connection
    // is asked. A fresh read, so a deleted item or a revoked token isn't hidden by the cache.
    const reads = await Promise.all(
      connections.map(async (connection) => ({
        connection,
        read: await context.providers.resource<RollbarResourceInput, RollbarItemMetadata>({
          providerId: PROVIDER,
          connectionId: connection.id,
          resourceId: ROLLBAR_ITEMS_RESOURCE,
          input: { kind: 'item', itemId },
          force: true,
          requireFresh: true,
        }),
      })),
    )

    const items: BrowserHandoffItem[] = []
    const failures: { connection: StoredConnection; failure: RouteFailure }[] = []
    for (const { connection, read } of reads) {
      if (!read.ok) {
        // Not in this project is what every connection but one answers.
        if (read.failure.status !== 404) failures.push({ connection, failure: read.failure })
        continue
      }
      // Rollbar's own id for what it answered has to be the page's. The counter is never taken from
      // the address: it is the project's number for the item, and differs from the id.
      if (read.value.itemId !== itemId) continue
      items.push(await handoffItem(context, connection, read.value, dependencies.projectsFor))
    }
    // A project that answered is a real answer even when another connection failed, as on the rail.
    if (items.length) return Response.json({ items: items.slice(0, 8) } satisfies BrowserHandoffResolution)
    if (failures.length) return failureRefusal(failures)
    return refusal(
      404,
      'not_found',
      `No connected Rollbar project can show item ${itemId}. It may have been deleted, or be in a project Acorn isn't connected to.`,
    )
  }
}

async function handoffItem(
  context: PluginRequestContext,
  connection: StoredConnection,
  item: RollbarItemMetadata,
  projectsFor: (connectionId: string) => Promise<string[]>,
): Promise<BrowserHandoffItem> {
  const { link, ...fields } = rollbarTaskFields(item)
  return {
    identifier: `#${item.identifier}`,
    url: item.url ?? `https://rollbar.com/item/${item.itemId}/`,
    title: item.title.slice(0, 300),
    connection: { id: connection.id, label: connectionName(connection) },
    projects: (await projectsFor(connection.id)).slice(0, 16),
    // The rail's promotion seed: the link is how a task already holding this item is found, in any
    // project.
    seed: { ...fields, links: [link] },
    context: {
      label: `Rollbar item #${item.identifier}`,
      content: itemContext(item, await latestOccurrence(context, connection.id, item.identifier)),
    },
  }
}

// The newest occurrence, which is where the trace is. Soft, as for `issue_detail`: an item whose
// occurrences can't be read is still worth handing over with its title, level, and environment.
async function latestOccurrence(
  context: PluginRequestContext,
  connectionId: string,
  identifier: string,
): Promise<RollbarOccurrenceDetail | null> {
  const list = await context.providers.resource<RollbarOccurrencesInput, RollbarOccurrencesResponse>({
    providerId: PROVIDER,
    connectionId,
    resourceId: ROLLBAR_OCCURRENCES_RESOURCE,
    input: { identifier },
  })
  const latest = list.ok ? list.value.occurrences[0] : undefined
  if (!latest) return null
  const occurrence = await context.providers.resource<RollbarOccurrenceInput, RollbarOccurrenceDetail>({
    providerId: PROVIDER,
    connectionId,
    resourceId: ROLLBAR_OCCURRENCE_RESOURCE,
    input: { identifier, occurrenceId: latest.id },
  })
  return occurrence.ok ? occurrence.value : null
}

// Never 401: the extension's host reads a 401 as the Node refusing the browser itself.
const refusal = (status: 400 | 403 | 404 | 429 | 502, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// The failure the person can act on first: a token to reconnect, then a limit to wait out.
function failureRefusal(failures: { connection: StoredConnection; failure: RouteFailure }[]): Response {
  const needsAuth = failures.find(({ failure }) => failure.status === 401)
  if (needsAuth)
    return refusal(
      403,
      'provider_needs_auth',
      `Rollbar didn't accept the saved token for ${connectionName(needsAuth.connection)}. Reconnect it in Acorn's settings.`,
    )
  if (failures.some(({ failure }) => failure.status === 429))
    return refusal(429, 'provider_rate_limited', 'Rollbar is limiting requests right now. Try again in a minute.')
  return refusal(502, 'provider_unavailable', "Rollbar didn't answer. Try again shortly.")
}

const time = (millis: number | null) => (millis == null ? 'unknown' : new Date(millis).toISOString())

// The allowlisted fields normalize.ts already keeps, minus the person: who hit an error isn't needed
// to investigate it. A request shows its method and path, without a query string that can carry a
// token.
function itemContext(item: RollbarItemMetadata, occurrence: RollbarOccurrenceDetail | null): string {
  const lines = [
    `Rollbar item #${item.identifier}: ${item.title}`,
    item.url ?? '',
    `Level: ${item.level} · Environment: ${item.environment || 'unknown'} · Status: ${item.status || 'unknown'}`,
    `Occurrences: ${item.totalOccurrences} · First seen ${time(item.firstOccurrenceAt)} · Last seen ${time(item.lastOccurrenceAt)}`,
    [
      item.framework ? `Framework: ${item.framework}` : '',
      item.resolvedInVersion ? `Resolved in version: ${item.resolvedInVersion}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  ].filter(Boolean)
  if (occurrence) lines.push('', ...occurrenceLines(occurrence))
  return truncateBytes(lines.join('\n'), CONTEXT_MAX_BYTES)
}

function occurrenceLines(occurrence: RollbarOccurrenceDetail): string[] {
  const where = [
    occurrence.environment ? `Environment: ${occurrence.environment}` : '',
    occurrence.codeVersion ? `Code version: ${occurrence.codeVersion}` : '',
    occurrence.server?.branch ? `Branch: ${occurrence.server.branch}` : '',
    occurrence.server?.host ? `Host: ${occurrence.server.host}` : '',
    occurrence.platform || occurrence.language
      ? `Platform: ${[occurrence.platform, occurrence.language].filter(Boolean).join(', ')}`
      : '',
  ].filter(Boolean)
  const request = occurrence.request?.url
    ? `Request: ${[occurrence.request.method, occurrence.request.url.split(/[?#]/, 1)[0]].filter(Boolean).join(' ')}`
    : ''
  const frames = occurrence.frames.flatMap((frame, index) => {
    const line = `  ${frame.filename}${frame.line == null ? '' : `:${frame.line}`}${frame.method ? ` in ${frame.method}` : ''}`
    // Rollbar lists frames oldest first, so the frame that raised is the last.
    if (index < occurrence.frames.length - CODE_FRAMES) return [line]
    return [line, ...frame.code.map((code) => `      ${code.line} | ${code.text}`)]
  })
  return [
    `Latest occurrence, ${time(occurrence.occurredAt)}:`,
    [occurrence.exceptionClass, occurrence.message].filter(Boolean).join(': ') || `(${occurrence.kind})`,
    ...(where.length ? [where.join(' · ')] : []),
    ...(request ? [request] : []),
    ...(occurrence.context ? [`Context: ${occurrence.context}`] : []),
    ...(frames.length ? ['Stack trace, most recent call last:', ...frames] : []),
    ...(occurrence.truncated ? ['Some of this occurrence was left out by Acorn to keep it small.'] : []),
  ]
}

type ProjectReads = Pick<CoreServices['projects'], 'checkouts' | 'byId' | 'externalProjects'>

// Projects whose workspace maps this connection, the rail's rule read the other way: a Rollbar
// connection is one Rollbar project, so the mapping is the whole test, and a mapping that names one
// Acorn project covers only that one. A project with no folder on disk isn't offered, as with GitHub's
// and Linear's handoffs.
export async function projectsMappingConnection(projects: ProjectReads, connectionId: string): Promise<string[]> {
  const refs = await Promise.all((await projects.checkouts()).map((checkout) => projects.byId(checkout.id)))
  const mappings = new Map<string, ReturnType<ProjectReads['externalProjects']>>()
  const found: string[] = []
  for (const ref of refs) {
    if (!ref) continue
    if (!mappings.has(ref.workspaceId)) mappings.set(ref.workspaceId, projects.externalProjects(ref.workspaceId))
    const rows = await mappings.get(ref.workspaceId)!
    if (rows.some((row) => row.connectionId === connectionId && (!row.projectId || row.projectId === ref.id)))
      found.push(ref.id)
  }
  return found
}
