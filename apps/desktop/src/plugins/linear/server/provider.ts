import { and, eq } from 'drizzle-orm'
import type { LinearActivity, LinearComment, LinearIssueDetail, LinearIssueSummary } from '../../../core/shared/api'
import type { ExternalRef } from '../../../core/shared/integrations'
import { schema } from '../../../core/server/db'
import {
  COMMENT_CREATE,
  ISSUE_DETAIL_QUERY,
  VIEWER_QUERY,
  issuesFilter,
  type LinearNode,
  type Viewer,
  linearData,
  linearError,
  linearFetch,
} from './'
import { encodeCached, isRecord, parseCached } from '../../../core/server/integrations/codec'
import {
  ProviderOperationError,
  type CachedExternalItem,
  type CachedItemCodec,
  type CodecResult,
  type MirroredResourceContribution,
} from '../../../core/server/integrations/types'
import { defaultBudgets, externalIdsFor, publicProvider } from '../../../core/server/integrations/providers/shared'

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
    const [row] = await context.db
      .select()
      .from(schema.issues)
      .where(and(
        eq(schema.issues.userId, context.userId),
        eq(schema.issues.integrationId, context.connection.id),
        eq(schema.issues.identifier, input.identifier),
      ))
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
      await context.db
        .insert(schema.issues)
        .values({ userId: context.userId, integrationId: context.connection.id, provider: 'linear', identifier: detail.identifier, data, fetchedAt: context.now })
        .onConflictDoUpdate({
          target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier],
          set: { data, fetchedAt: context.now },
        })
      return { ok: true }
    } catch {
      return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }
    }
  },
}

export const linearProvider = publicProvider({
  id: 'linear',
  label: 'Linear',
  glyph: '◷',
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
