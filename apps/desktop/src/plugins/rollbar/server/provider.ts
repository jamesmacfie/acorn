import { and, eq } from 'drizzle-orm'
import type { RollbarItemMetadata, RollbarItemSummary } from '../../../core/shared/api'
import type { ExternalRef } from '../../../core/shared/integrations'
import { schema } from '../../../core/server/db'
import {
  itemByCounterPath,
  itemByIdPath,
  itemsPath,
  projectPath,
  rollbarData,
  rollbarFetch,
  type RollbarApiItem,
  type RollbarProject,
} from './'
import { normalizeItemMetadata, normalizeSummary, rollbarItemUrl } from './normalize'
import { encodeCached, isRecord, parseCached } from '../../../core/server/integrations/codec'
import {
  ProviderOperationError,
  type CachedExternalItem,
  type CachedItemCodec,
  type CodecResult,
  type MirroredResourceContribution,
  type ProviderResourceContext,
  type ProviderResourceRefreshContext,
} from '../../../core/server/integrations/types'
import type { RouteFailure } from '../../../core/server/sync/engine'
import { defaultBudgets, externalIdsFor, publicProvider } from '../../../core/server/integrations/providers/shared'
import {
  createRollbarOccurrenceResources,
} from './occurrenceResources'

const ROLLBAR_PER_PAGE = 100
export const ROLLBAR_ITEMS_RESOURCE = 'rollbar.items'

type RollbarValidated = { project: RollbarProject; secret: string }
type RollbarCached = CachedExternalItem<RollbarItemSummary, RollbarItemMetadata>
export type RollbarResourceInput = { kind: 'list' } | { kind: 'detail'; identifier: string }
export type RollbarListResult = { items: RollbarItemSummary[]; capped: boolean }
export type RollbarResourceOutput = RollbarListResult | RollbarItemMetadata

const isSummary = (value: unknown): value is RollbarItemSummary =>
  isRecord(value) && typeof value.integrationId === 'string' && typeof value.identifier === 'string' &&
  typeof value.title === 'string' && (typeof value.url === 'string' || value.url === null)
const isMetadata = (value: unknown): value is RollbarItemMetadata =>
  isSummary(value) && isRecord(value) && 'resolvedInVersion' in value && 'assignedTo' in value && 'url' in value

const metadataOf = (value: RollbarItemMetadata): RollbarItemMetadata => ({
  ...summaryOf(value),
  resolvedInVersion: typeof value.resolvedInVersion === 'string' ? value.resolvedInVersion : null,
  assignedTo: typeof value.assignedTo === 'string' ? value.assignedTo : null,
  url: typeof value.url === 'string' ? value.url : null,
})

// Widen an old (pre-itemId) summary/legacy row into the v4 summary. itemId/label are unknown for
// legacy rows — left blank; a detail fetch resolves the real id via the counter, and the list refresh
// restamps label. Migrated rows never carry the current listFetchedAt, so they stay out of the list.
function widen(o: Record<string, unknown>): RollbarItemSummary {
  const itemId = typeof o.itemId === 'string' ? o.itemId : ''
  return {
    integrationId: String(o.integrationId ?? ''),
    integrationLabel: typeof o.integrationLabel === 'string' ? o.integrationLabel : '',
    identifier: String(o.identifier ?? ''),
    itemId,
    url: typeof o.url === 'string' ? o.url : rollbarItemUrl(itemId),
    title: String(o.title ?? ''),
    level: String(o.level ?? ''),
    environment: String(o.environment ?? ''),
    status: String(o.status ?? ''),
    totalOccurrences: typeof o.totalOccurrences === 'number' ? o.totalOccurrences : 0,
    firstOccurrenceAt: typeof o.firstOccurrenceAt === 'number' ? o.firstOccurrenceAt : null,
    lastOccurrenceAt: typeof o.lastOccurrenceAt === 'number' ? o.lastOccurrenceAt : null,
    ...(typeof o.framework === 'string' ? { framework: o.framework } : {}),
  }
}

function widenMetadata(value: unknown): RollbarItemMetadata | undefined {
  if (!isRecord(value) || !('resolvedInVersion' in value) || !('assignedTo' in value)) return undefined
  return {
    ...widen(value),
    resolvedInVersion: typeof value.resolvedInVersion === 'string' ? value.resolvedInVersion : null,
    assignedTo: typeof value.assignedTo === 'string' ? value.assignedTo : null,
  }
}

function parseRollbar(raw: unknown, ref: ExternalRef): CodecResult<RollbarCached> {
  if (isRecord(raw) && raw.schemaVersion === 4 && isSummary(raw.summary)) {
    return {
      ok: true,
      migrated: false,
      value: {
        ref: isRecord(raw.ref) ? (raw.ref as ExternalRef) : ref,
        summary: raw.summary,
        detail: isMetadata(raw.detail) ? metadataOf(raw.detail) : undefined,
        listFetchedAt: typeof raw.listFetchedAt === 'number' ? raw.listFetchedAt : undefined,
        detailFetchedAt: typeof raw.detailFetchedAt === 'number' ? raw.detailFetchedAt : undefined,
        schemaVersion: 4,
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : undefined,
        truncated: raw.truncated === true,
      },
    }
  }
  // v3 predates stable web links. Derive the item permalink from its system-wide item id while
  // retaining independently cached metadata and list/detail freshness.
  if (isRecord(raw) && raw.schemaVersion === 3 && isRecord(raw.summary)) {
    return {
      ok: true,
      migrated: true,
      value: {
        ref: isRecord(raw.ref) ? (raw.ref as ExternalRef) : ref,
        summary: widen(raw.summary),
        detail: widenMetadata(raw.detail),
        listFetchedAt: typeof raw.listFetchedAt === 'number' ? raw.listFetchedAt : undefined,
        detailFetchedAt: typeof raw.detailFetchedAt === 'number' ? raw.detailFetchedAt : undefined,
        schemaVersion: 4,
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : undefined,
        truncated: raw.truncated === true,
      },
    }
  }
  // v2 detail bundled latestOccurrence. Strip that child resource while retaining canonical item
  // metadata; occurrence history now has independent cache rows and freshness.
  if (isRecord(raw) && raw.schemaVersion === 2 && isRecord(raw.summary)) {
    return {
      ok: true,
      migrated: true,
      value: {
        ref: isRecord(raw.ref) ? (raw.ref as ExternalRef) : ref,
        summary: widen(raw.summary),
        detail: widenMetadata(raw.detail),
        listFetchedAt: typeof raw.listFetchedAt === 'number' ? raw.listFetchedAt : undefined,
        detailFetchedAt: typeof raw.detailFetchedAt === 'number' ? raw.detailFetchedAt : undefined,
        schemaVersion: 4,
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : undefined,
        truncated: raw.truncated === true,
      },
    }
  }
  // v1 envelope (summary/detail both the old RollbarItem shape): keep list membership, drop the old
  // detail — it lacked the occurrence, so a detail fetch repopulates it.
  if (isRecord(raw) && raw.schemaVersion === 1 && isRecord(raw.summary)) {
    return { ok: true, migrated: true, value: { ref, summary: widen(raw.summary), listFetchedAt: typeof raw.listFetchedAt === 'number' ? raw.listFetchedAt : undefined, schemaVersion: 4 } }
  }
  // Legacy bare RollbarItem row.
  if (isRecord(raw) && typeof raw.identifier === 'string' && typeof raw.title === 'string') {
    return { ok: true, migrated: true, value: { ref, summary: widen(raw), schemaVersion: 4 } }
  }
  return { ok: false, error: 'invalid_rollbar_cache' }
}

function summaryOf(detail: RollbarItemMetadata): RollbarItemSummary {
  const { resolvedInVersion: _r, assignedTo: _a, ...summary } = detail
  return summary
}

const rollbarCodec: CachedItemCodec<RollbarItemSummary, RollbarItemMetadata, RollbarItemSummary> = {
  schemaVersion: 4,
  parse: parseRollbar,
  // List refresh: new summary wins, existing detail + its freshness are preserved (docs/caching.md).
  mergeSummary(existing, ref, summary, fetchedAt) {
    return { ref, summary, detail: existing?.detail, detailFetchedAt: existing?.detailFetchedAt, listFetchedAt: fetchedAt, truncated: existing?.truncated, schemaVersion: 4 }
  },
  // Detail refresh sets its own detailFetchedAt; the caller re-applies the preserved listFetchedAt.
  withDetail(ref, summary, detail, fetchedAt) {
    return { ref, summary, detail, detailFetchedAt: fetchedAt, schemaVersion: 4 }
  },
  toPublic: (item) => item.summary,
  summary: (item) => item.summary,
}

const resourceKey = (connectionId: string, input: RollbarResourceInput) =>
  `provider:rollbar:${connectionId}:items:${input.kind === 'list' ? 'list' : input.identifier}`

const issueRow = (context: Pick<RefreshCtx, 'db' | 'userId'>, integrationId: string, identifier: string) =>
  context.db
    .select()
    .from(schema.issues)
    .where(and(eq(schema.issues.userId, context.userId), eq(schema.issues.integrationId, integrationId), eq(schema.issues.identifier, identifier)))

type RefreshCtx = ProviderResourceRefreshContext

async function upsertIssue(context: RefreshCtx, summary: RollbarItemSummary, cached: RollbarCached): Promise<void> {
  const data = encodeCached(cached, context.limits.maxCachedItemBytes)
  await context.db
    .insert(schema.issues)
    .values({ userId: context.userId, integrationId: summary.integrationId, provider: 'rollbar', identifier: summary.identifier, data, fetchedAt: context.now })
    .onConflictDoUpdate({
      target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier],
      set: { data, fetchedAt: context.now },
    })
}

function refForSummary(summary: RollbarItemSummary): ExternalRef {
  return { providerId: 'rollbar', connectionId: summary.integrationId, displayId: summary.identifier, ...(summary.itemId ? { externalId: summary.itemId } : {}) }
}

async function persistSummary(context: RefreshCtx, summary: RollbarItemSummary): Promise<void> {
  const ref = refForSummary(summary)
  const [previous] = await issueRow(context, summary.integrationId, summary.identifier)
  const parsed = previous ? parseCached(rollbarCodec, previous.data, ref) : null
  await upsertIssue(context, summary, rollbarCodec.mergeSummary(parsed?.ok ? parsed.value : null, ref, summary, context.now))
}

async function persistDetail(context: RefreshCtx, detail: RollbarItemMetadata): Promise<void> {
  const summary = summaryOf(detail)
  const ref = { ...refForSummary(summary), ...(detail.url ? { url: detail.url } : {}) }
  const [previous] = await issueRow(context, detail.integrationId, detail.identifier)
  const parsed = previous ? parseCached(rollbarCodec, previous.data, ref) : null
  const base = rollbarCodec.withDetail(ref, summary, detail, context.now)
  // Detail write must NOT touch list membership (docs/caching.md): preserve the existing listFetchedAt.
  await upsertIssue(context, summary, { ...base, listFetchedAt: parsed?.ok ? parsed.value.listFetchedAt : undefined })
}

const failFor = (response: Response): RouteFailure | null => {
  if (response.status === 401 || response.status === 403) return { error: 'provider_needs_auth', status: 401 }
  if (response.status === 429) return { error: 'provider_rate_limited', status: 429 }
  if (response.status === 404) return { error: 'provider_resource_not_found', status: 404 }
  if (!response.ok) return { error: 'provider_unavailable', status: 502 }
  return null
}

const rollbarItemsResource: MirroredResourceContribution<RollbarResourceInput, RollbarResourceOutput> = {
  id: ROLLBAR_ITEMS_RESOURCE,
  ttlMs: 2 * 60_000,
  merge: 'summary-preserves-detail',
  key: resourceKey,
  async read(context, input) {
    if (input.kind === 'detail') {
      const [row] = await issueRow(context, context.connection.id, input.identifier)
      if (!row) return null
      const parsed = parseCached(rollbarCodec, row.data, { providerId: 'rollbar', connectionId: context.connection.id, displayId: input.identifier })
      // Only a real detail read counts as cached; its freshness is detailFetchedAt (never the list's).
      return parsed.ok && parsed.value.detail && parsed.value.detailFetchedAt != null
        ? { data: parsed.value.detail, fetchedAt: parsed.value.detailFetchedAt }
        : null
    }

    const key = resourceKey(context.connection.id, input)
    const [state, rows] = await Promise.all([
      context.db.select().from(schema.syncState).where(and(eq(schema.syncState.userId, context.userId), eq(schema.syncState.resource, key))),
      context.db.select().from(schema.issues).where(and(
        eq(schema.issues.userId, context.userId),
        eq(schema.issues.integrationId, context.connection.id),
        eq(schema.issues.provider, 'rollbar'),
      )),
    ])
    const listAt = state[0]?.fetchedAt ?? null
    if (listAt == null) return null // never listed → cold, force a refresh
    // Current membership is exact: only rows stamped with THIS list's fetch time (docs/caching.md).
    const items = rows.flatMap((row) => {
      const parsed = parseCached(rollbarCodec, row.data, { providerId: 'rollbar', connectionId: row.integrationId, displayId: row.identifier })
      return parsed.ok && parsed.value.listFetchedAt === listAt ? [parsed.value.summary] : []
    })
    return { data: { items, capped: items.length >= context.limits.maxPages * ROLLBAR_PER_PAGE }, fetchedAt: listAt }
  },
  async refresh(context, input) {
    const label = context.connection.label
    try {
      if (input.kind === 'detail') {
        const [row] = await issueRow(context, context.connection.id, input.identifier)
        const cachedItemId = row
          ? (() => {
              const p = parseCached(rollbarCodec, row.data, { providerId: 'rollbar', connectionId: context.connection.id, displayId: input.identifier })
              return p.ok && p.value.summary.itemId ? p.value.summary.itemId : null
            })()
          : null
        // Prefer the known system id; fall back to counter resolution for legacy links.
        const itemRes = await rollbarFetch(context.secret, cachedItemId ? itemByIdPath(cachedItemId) : itemByCounterPath(input.identifier))
        const failure = failFor(itemRes)
        if (failure) return { ok: false, failure }
        const apiItem = await rollbarData<RollbarApiItem>(itemRes)
        const summary = normalizeSummary(context.connection.id, label, apiItem)
        await persistDetail(context, normalizeItemMetadata(summary, apiItem))
        return { ok: true }
      }

      const summaries: RollbarItemSummary[] = []
      for (let page = 1; page <= context.limits.maxPages; page++) {
        const response = await rollbarFetch(context.secret, itemsPath(page))
        const failure = failFor(response)
        if (failure) return { ok: false, failure }
        const raw = (await rollbarData<{ items?: RollbarApiItem[] }>(response)).items ?? []
        for (const item of raw) summaries.push(normalizeSummary(context.connection.id, label, item))
        if (raw.length < ROLLBAR_PER_PAGE) break
      }
      // Restamp every current-list summary with this refresh's time (mergeSummary keeps detail).
      // Absent rows are NOT deleted — they may still be linked to a task; they simply drop out of the
      // list because they no longer carry the current listFetchedAt.
      for (const summary of summaries) await persistSummary(context, summary)
      await context.db
        .insert(schema.syncState)
        .values({ userId: context.userId, resource: resourceKey(context.connection.id, input), fetchedAt: context.now })
        .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: context.now } })
      return { ok: true }
    } catch {
      return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }
    }
  },
}

async function cachedItemId(context: ProviderResourceContext, identifier: string): Promise<string | null> {
  const [row] = await issueRow(context, context.connection.id, identifier)
  if (!row) return null
  const parsed = parseCached(rollbarCodec, row.data, {
    providerId: 'rollbar', connectionId: context.connection.id, displayId: identifier,
  })
  return parsed.ok && parsed.value.summary.itemId ? parsed.value.summary.itemId : null
}

const occurrenceResources = createRollbarOccurrenceResources({
  cachedItemId,
  persistMetadata: persistDetail,
  failFor,
})

const CONFORMANCE_SUMMARY: RollbarItemSummary = {
  integrationId: 'rollbar-test', integrationLabel: 'Rollbar · acme', identifier: '142', itemId: '999',
  url: 'https://rollbar.com/item/999/',
  title: 'TypeError updated', level: 'error', environment: 'prod', status: 'active', totalOccurrences: 4,
  firstOccurrenceAt: 1, lastOccurrenceAt: 3,
}

export const rollbarProvider = publicProvider({
  id: 'rollbar',
  label: 'Rollbar',
  glyph: '◍',
  kind: 'error-tracker',
  connection: {
    authKind: 'api-key',
    connectable: true,
    disconnectable: true,
    fields: [{
      id: 'token', label: 'Project access token (read)', type: 'password', placeholder: 'read token…',
      hint: 'Rollbar → project → Settings → Project Access Tokens (read scope). One connection per project.', required: true,
    }],
    async validate(credentials): Promise<RollbarValidated> {
      const secret = credentials.token?.trim()
      if (!secret) throw new ProviderOperationError('provider_bad_config', 400)
      try {
        const response = await rollbarFetch(secret, projectPath)
        if (response.status === 401 || response.status === 403) throw new ProviderOperationError('provider_needs_auth', 401)
        if (!response.ok) throw new ProviderOperationError('provider_unavailable', 502)
        return { project: await rollbarData<RollbarProject>(response), secret }
      } catch (error) {
        if (error instanceof ProviderOperationError) throw error
        throw new ProviderOperationError('provider_unavailable', 502)
      }
    },
    normalize(_credentials, validated: RollbarValidated) {
      const projectId = String(validated.project.id)
      return {
        secret: validated.secret,
        label: `Rollbar · ${validated.project.name}`,
        account: { id: projectId, label: validated.project.name, type: 'project' },
        scopes: ['read'],
        config: { projectId },
        capabilities: { browse: 'available', linkExisting: 'available', promoteToTask: 'available', contextFormat: 'available' },
      }
    },
    async test(secret) {
      try {
        const response = await rollbarFetch(secret, projectPath)
        if (response.status === 401 || response.status === 403) return { ok: false, error: 'provider_needs_auth' }
        if (!response.ok) return { ok: false, error: 'provider_unavailable' }
        await rollbarData(response)
        return { ok: true }
      } catch {
        return { ok: false, error: 'provider_unavailable' }
      }
    },
  },
  externalIds: externalIdsFor('rollbar'),
  capabilities: {
    browse: true, linkExisting: true, promoteToTask: true, comments: 'none', repoAffinity: 'none', contextFormat: true,
  },
  resources: [rollbarItemsResource, occurrenceResources.occurrences, occurrenceResources.occurrence],
  codec: rollbarCodec,
  taskContext: {
    summarize(ref, item, state) {
      const data = (item as RollbarCached | null)?.summary
      return {
        id: `rollbar:${ref.connectionId}:${ref.displayId}`,
        kind: 'Rollbar',
        label: data ? `#${ref.displayId} — ${data.title}` : `#${ref.displayId}`,
        details: [data ? `${data.level} · ${data.status}` : '', state === 'fresh' ? '' : `Cache: ${state}`].filter(Boolean),
        jump: { pane: 'rollbar', itemId: ref.displayId, ref },
      }
    },
  },
  refs: {
    detectRefs: () => [],
    toRef(connectionId, candidate) {
      return { providerId: 'rollbar', connectionId, displayId: candidate.displayId, url: candidate.url }
    },
    canAutoLink: () => 'linkify-only',
  },
  budgets: { ...defaultBudgets, maxPages: 3, maxContextItems: 30 },
  memory: { linkedItems: true, mutations: [], triggers: [], summarize: 'context-formatter', acceptedWrites: false },
  conformance: {
    ref: { providerId: 'rollbar', connectionId: 'rollbar-test', displayId: '142' },
    // Legacy bare RollbarItem row (pre-itemId) — must migrate.
    legacyCache: {
      integrationId: 'rollbar-test', identifier: '142', title: 'TypeError', level: 'error', environment: 'prod',
      status: 'active', totalOccurrences: 3, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
    },
    summary: CONFORMANCE_SUMMARY,
    detail: {
      ...CONFORMANCE_SUMMARY, resolvedInVersion: null, assignedTo: null,
    } satisfies RollbarItemMetadata,
  },
})
