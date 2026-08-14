import type {
  LinearActivity,
  LinearAttachment,
  LinearComment,
  LinearIssueDetail,
  LinearIssueSummary,
  LinearRelatedIssue,
  LinearRelation,
  LinearRelationKind,
} from '../shared/api'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import {
  COMMENT_CREATE,
  ISSUE_DETAIL_QUERY,
  PROJECTS_QUERY,
  VIEWER_QUERY,
  issuesFilter,
  type LinearNode,
  type LinearProjectNode,
  type LinearRelatedNode,
  type Viewer,
  linearData,
  linearError,
  linearFetch,
} from './'
import { type CachedExternalItem, type CachedItemCodec, type CodecResult, defaultBudgets, encodeCached, externalIdsFor, isRecord, type MirroredResourceContribution, parseCached, ProviderOperationError, type ProviderProjectSource, publicProvider } from '@acorn/plugin-api/node'

type LinearValidated = { viewer: Viewer; secret: string }
type LinearCached = CachedExternalItem<LinearIssueSummary, LinearIssueDetail>

const validSummary = (value: unknown): value is LinearIssueSummary =>
  isRecord(value) && typeof value.identifier === 'string' && typeof value.title === 'string' && typeof value.url === 'string'

export const linearSummaryOf = (detail: LinearIssueDetail): LinearIssueSummary => ({
  identifier: detail.identifier,
  title: detail.title,
  url: detail.url,
  state: detail.state,
  assignee: detail.assignee,
})

function buildActivity(node: LinearNode): LinearActivity[] {
  const labels = new Map((node.labels?.nodes ?? []).map((label) => [label.id, label.name]))
  const items: LinearActivity[] = []
  if (node.createdAt) {
    items.push({ id: 'created', actor: node.creator?.name ?? null, text: 'created the issue', createdAt: Date.parse(node.createdAt) || null, icon: 'created' })
  }
  for (const history of node.history?.nodes ?? []) {
    const actor = history.actor?.name ?? history.botActor?.name ?? null
    const createdAt = Date.parse(history.createdAt) || null
    const push = (icon: string, text: string, color?: string) =>
      items.push({ id: `${history.id}:${items.length}`, actor, text, createdAt, icon, color })
    if (history.toState) push('state', history.fromState ? `moved from ${history.fromState.name} to ${history.toState.name}` : `moved to ${history.toState.name}`, history.toState.color)
    if (history.toAssignee) push('assignee', history.toAssignee.name === actor ? 'self-assigned the issue' : `assigned to ${history.toAssignee.name}`)
    else if (history.fromAssignee) push('assignee', 'unassigned the issue')
    for (const id of history.addedLabelIds ?? []) push('label', `added label ${labels.get(id) ?? '—'}`)
    for (const id of history.removedLabelIds ?? []) push('label', `removed label ${labels.get(id) ?? '—'}`)
    if (history.toTitle && history.fromTitle) push('title', 'changed the title')
  }
  return items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

const relatedIssueOf = (node: LinearRelatedNode): LinearRelatedIssue => ({
  id: node.id,
  identifier: node.identifier,
  title: node.title,
  state: node.state,
})

function buildAttachments(node: LinearNode): LinearAttachment[] {
  return (node.attachments?.nodes ?? [])
    .filter((a) => a.url)
    .map((a) => ({ id: a.id, title: a.title || a.url, subtitle: a.subtitle ?? null, url: a.url, sourceType: a.sourceType ?? null }))
}

// Normalize the issue graph. Outgoing `relations` read forward (this issue blocks X); `inverseRelations`
// read backward (X blocks this issue → this is blocked by X). Linear stores one relation record per
// link, surfaced via `relations` on the source issue and `inverseRelations` on the target — so a
// symmetric "related" link must be mapped on both sides or the target issue never shows it.
function buildRelations(node: LinearNode): LinearRelation[] {
  const forward: Record<string, { kind: LinearRelationKind; label: string }> = {
    blocks: { kind: 'blocks', label: 'Blocks' },
    duplicate: { kind: 'duplicate', label: 'Duplicate of' },
    related: { kind: 'related', label: 'Related' },
  }
  const inverse: Record<string, { kind: LinearRelationKind; label: string }> = {
    blocks: { kind: 'blocked-by', label: 'Blocked by' },
    duplicate: { kind: 'duplicated-by', label: 'Duplicated by' },
    related: { kind: 'related', label: 'Related' },
  }
  const out: LinearRelation[] = []
  for (const rel of node.relations?.nodes ?? []) {
    if (!rel.relatedIssue) continue
    const meta = forward[rel.type] ?? { kind: 'related' as const, label: 'Related' }
    out.push({ id: rel.id, kind: meta.kind, label: meta.label, issue: relatedIssueOf(rel.relatedIssue) })
  }
  for (const rel of node.inverseRelations?.nodes ?? []) {
    if (!rel.issue) continue
    const meta = inverse[rel.type]
    if (!meta) continue
    out.push({ id: rel.id, kind: meta.kind, label: meta.label, issue: relatedIssueOf(rel.issue) })
  }
  return out
}

export function linearNodeToDetail(node: LinearNode): LinearIssueDetail {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    state: node.state,
    assignee: node.assignee?.name ?? null,
    description: node.description ?? null,
    comments: (node.comments?.nodes ?? []).map((comment) => ({
      id: comment.id,
      author: comment.user?.name ?? null,
      body: comment.body,
      createdAt: Date.parse(comment.createdAt) || null,
      parentId: comment.parent?.id ?? null,
    }) satisfies LinearComment),
    activity: buildActivity(node),
    labels: (node.labels?.nodes ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    createdAt: node.createdAt ? Date.parse(node.createdAt) || null : null,
    updatedAt: node.updatedAt ? Date.parse(node.updatedAt) || null : null,
    creator: node.creator?.name ?? null,
    priority: node.priority ?? null,
    priorityLabel: node.priorityLabel ?? null,
    estimate: node.estimate ?? null,
    dueDate: node.dueDate ?? null,
    branchName: node.branchName ?? null,
    team: node.team ?? null,
    project: node.project ?? null,
    cycle: node.cycle ?? null,
    attachments: buildAttachments(node),
    parent: node.parent ? relatedIssueOf(node.parent) : null,
    children: (node.children?.nodes ?? []).map(relatedIssueOf),
    relations: buildRelations(node),
  }
}

function parseLinear(raw: unknown, ref: ExternalRef): CodecResult<LinearCached> {
  if (isRecord(raw) && raw.schemaVersion === 1 && validSummary(raw.summary)) {
    const detailRaw = raw.detail
    const detail = isRecord(detailRaw) && validSummary(detailRaw) && typeof (detailRaw as Record<string, unknown>).id === 'string' ? (detailRaw as LinearIssueDetail) : undefined
    return {
      ok: true,
      migrated: false,
      value: {
        ref: isRecord(raw.ref) ? (raw.ref as ExternalRef) : ref,
        summary: raw.summary,
        detail,
        listFetchedAt: typeof raw.listFetchedAt === 'number' ? raw.listFetchedAt : undefined,
        detailFetchedAt: typeof raw.detailFetchedAt === 'number' ? raw.detailFetchedAt : undefined,
        schemaVersion: 1,
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : undefined,
        truncated: raw.truncated === true,
      },
    }
  }
  // Phase-7 read migration: pre-descriptor rows stored the public detail object directly.
  if (validSummary(raw)) {
    const detail = isRecord(raw) && typeof (raw as Record<string, unknown>).id === 'string' ? (raw as LinearIssueDetail) : undefined
    return { ok: true, migrated: true, value: { ref, summary: detail ? linearSummaryOf(detail) : raw, detail, schemaVersion: 1 } }
  }
  return { ok: false, error: 'invalid_linear_cache' }
}

const refForIdentifier = (connectionId: string, identifier: string, url?: string): ExternalRef => ({
  providerId: 'linear',
  connectionId,
  displayId: identifier,
  url,
})

const linearCodec: CachedItemCodec<LinearIssueSummary, LinearIssueDetail, LinearIssueDetail> = {
  schemaVersion: 1,
  parse: parseLinear,
  mergeSummary(existing, ref, summary, fetchedAt) {
    return { ref, summary, detail: existing?.detail, detailFetchedAt: existing?.detailFetchedAt, listFetchedAt: fetchedAt, schemaVersion: 1 }
  },
  withDetail(ref, summary, detail, fetchedAt) {
    return { ref, summary, detail, detailFetchedAt: fetchedAt, listFetchedAt: fetchedAt, schemaVersion: 1 }
  },
  toPublic(item) {
    return item.detail ?? ({ ...item.summary, id: '', description: null, comments: [], activity: [] } satisfies LinearIssueDetail)
  },
  summary: (item) => item.summary,
}

export type LinearResourceInput = { kind: 'detail'; identifier: string }

const linearIssuesResource: MirroredResourceContribution<LinearResourceInput, LinearIssueDetail> = {
  id: 'linear.issues',
  ttlMs: 10 * 60_000,
  merge: 'summary-preserves-detail',
  key: (connectionId, input) => `provider:linear:${connectionId}:issues:${input.identifier}`,
  async read(context, input) {
    const row = await context.items.read(context.connection.id, input.identifier)
    if (!row) return null
    const parsed = parseCached(linearCodec, row.data, refForIdentifier(context.connection.id, input.identifier))
    return parsed.ok && parsed.value.detail ? { data: parsed.value.detail, fetchedAt: row.fetchedAt } : null
  },
  async refresh(context, input) {
    const filter = issuesFilter([input.identifier])
    if (!filter) return { ok: false, failure: { error: 'provider_resource_not_found', status: 404 } }
    try {
      const response = await linearFetch(context.secret, ISSUE_DETAIL_QUERY, { filter })
      const error = linearError(response)
      if (error) return { ok: false, failure: { error: error.status === 401 ? 'provider_needs_auth' : 'provider_unavailable', status: error.status } }
      const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(response)
      const node = issues.nodes[0]
      if (!node) return { ok: false, failure: { error: 'provider_resource_not_found', status: 404 } }
      const detail = linearNodeToDetail(node)
      const ref = refForIdentifier(context.connection.id, detail.identifier, detail.url)
      const data = encodeCached(linearCodec.withDetail(ref, linearSummaryOf(detail), detail, context.now), context.limits.maxCachedItemBytes)
      // `write` is an upsert keyed on (owner, connection, identifier) — the same conflict target the
      // raw statement declared, kept in one place now that two providers share the table.
      await context.items.write({ connectionId: context.connection.id, identifier: detail.identifier, data, fetchedAt: context.now })
      return { ok: true }
    } catch {
      return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }
    }
  },
}

// The projects a Linear workspace offers, for the HOST's workspace-mapping picker. This is the fetch
// that used to sit behind `GET /v2/p/linear/projects`, moved onto the provider contribution so core
// can ask it without knowing it is asking Linear — that route had no caller left, because the browse
// pane that called it is a host-drawn rail now.
//
// No error handling beyond "no projects": the host runs this inside the secret scope and the request
// budget and turns a throw into a per-connection failure the picker can retry, so swallowing a 401
// here would only hide it. Same division as `linearIssuesResource.refresh` above.
const linearProjectSource: ProviderProjectSource = {
  async list({ secret }) {
    const response = await linearFetch(secret, PROJECTS_QUERY, {})
    const error = linearError(response)
    if (error) throw new ProviderOperationError(error.status === 401 ? 'provider_needs_auth' : 'provider_unavailable', error.status)
    const { projects } = await linearData<{ projects: { nodes: LinearProjectNode[] } }>(response)
    return projects.nodes.map((node) => ({ id: node.id, label: node.name }))
  },
}

export const linearProvider = publicProvider({
  id: 'linear',
  label: 'Linear',
  glyph: 'brand:linear',
  kind: 'issue-tracker',
  connection: {
    authKind: 'api-key',
    connectable: true,
    disconnectable: true,
    fields: [
      {
        id: 'token',
        label: 'Personal API key',
        type: 'password',
        placeholder: 'lin_api_…',
        hint: 'Linear → Settings → Security & access → Personal API keys. You can connect more than one workspace.',
        required: true,
      },
    ],
    async validate(credentials): Promise<LinearValidated> {
      const secret = credentials.token?.trim()
      if (!secret) throw new ProviderOperationError('provider_bad_config', 400)
      const response = await linearFetch(secret, VIEWER_QUERY, {})
      if (linearError(response)) throw new ProviderOperationError('provider_needs_auth', 401)
      try {
        return { viewer: await linearData<Viewer>(response), secret }
      } catch {
        throw new ProviderOperationError('provider_needs_auth', 401)
      }
    },
    normalize(_credentials, validated: LinearValidated) {
      const workspace = validated.viewer.viewer.organization.name
      return {
        secret: validated.secret,
        label: `Linear · ${workspace}`,
        account: { id: workspace, label: workspace, type: 'workspace' },
        scopes: ['read', 'comments:write'],
        config: {},
        capabilities: {
          browse: 'available',
          linkExisting: 'available',
          promoteToTask: 'available',
          comments: 'available',
          branchSuggestion: 'available',
          contextFormat: 'available',
        },
      }
    },
    async test(secret) {
      const response = await linearFetch(secret, VIEWER_QUERY, {})
      return linearError(response) ? { ok: false, error: 'provider_needs_auth' } : { ok: true }
    },
  },
  externalIds: externalIdsFor('linear'),
  capabilities: {
    browse: true,
    linkExisting: true,
    promoteToTask: true,
    comments: 'write',
    branchSuggestion: true,
    repoAffinity: 'workspace',
    contextFormat: true,
    userFeed: true,
  },
  resources: [linearIssuesResource],
  projects: linearProjectSource,
  codec: linearCodec,
  taskContext: {
    summarize(ref, item, state) {
      const parsed = item as LinearCached | null
      const summary = parsed?.summary
      return {
        id: `linear:${ref.connectionId}:${ref.displayId}`,
        kind: 'Linear',
        label: summary ? `${ref.displayId} — ${summary.title}` : ref.displayId,
        details: [summary?.state?.name ?? '', state === 'fresh' ? '' : `Cache: ${state}`].filter(Boolean),
        jump: { pane: 'linear', itemId: ref.displayId, ref },
      }
    },
  },
  refs: {
    detectRefs(text) {
      const re = /https?:\/\/linear\.app\/[^/\s"'<>]+\/issue\/([A-Z][A-Z0-9]*-\d+)/g
      return [...text.matchAll(re)].map((match) => ({ displayId: match[1], url: match[0], confidence: 'exact-url' as const }))
    },
    toRef(connectionId, candidate) {
      return refForIdentifier(connectionId, candidate.displayId, candidate.url)
    },
    canAutoLink: () => 'linkify-only',
  },
  mutations: [
    {
      id: 'linear.comment',
      capability: 'comments',
      risk: 'write',
      freshness: 'live-fetch-first',
      invalidates: ['linear.issues.detail'],
      idempotent: false,
      async run({ secret, input }) {
        const response = await linearFetch(secret, COMMENT_CREATE, { input })
        const error = linearError(response)
        if (error) throw new ProviderOperationError(error.status === 401 ? 'provider_needs_auth' : 'provider_unavailable', error.status)
        const data = await linearData<{ commentCreate: { success: boolean } }>(response)
        if (!data.commentCreate.success) throw new ProviderOperationError('provider_unavailable', 502)
        return { ok: true }
      },
    },
  ],
  budgets: { ...defaultBudgets, maxResolutionBatch: 50, maxContextItems: 50 },
  memory: { linkedItems: true, mutations: ['linear.comment'], triggers: [], summarize: 'context-formatter', acceptedWrites: false },
  conformance: {
    ref: refForIdentifier('linear-test', 'ENG-42', 'https://linear.app/acme/issue/ENG-42'),
    legacyCache: {
      id: 'issue-uuid', identifier: 'ENG-42', title: 'Detailed issue', url: 'https://linear.app/acme/issue/ENG-42',
      state: { name: 'In Progress', type: 'started', color: '#55f' }, assignee: null,
      description: 'Keep this description', comments: [], activity: [],
    } satisfies LinearIssueDetail,
    summary: {
      identifier: 'ENG-42', title: 'Updated summary', url: 'https://linear.app/acme/issue/ENG-42',
      state: { name: 'In Progress', type: 'started', color: '#55f' }, assignee: null,
    } satisfies LinearIssueSummary,
    detail: {
      id: 'issue-uuid', identifier: 'ENG-42', title: 'Detailed issue', url: 'https://linear.app/acme/issue/ENG-42',
      state: { name: 'In Progress', type: 'started', color: '#55f' }, assignee: null,
      description: 'Keep this description', comments: [], activity: [],
    } satisfies LinearIssueDetail,
  },
})

export { refForIdentifier as linearRef }
