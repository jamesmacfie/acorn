import { and, eq, notInArray } from 'drizzle-orm'
import type { RollbarItem } from '../../../core/shared/api'
import type { ExternalRef } from '../../../core/shared/integrations'
import { schema } from '../../../core/server/db'
import {
  itemByCounterPath,
  itemsPath,
  levelName,
  projectPath,
  rollbarData,
  rollbarFetch,
  type RollbarApiItem,
  type RollbarProject,
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

type RollbarValidated = { project: RollbarProject; secret: string }
type RollbarCached = CachedExternalItem<RollbarItem, RollbarItem>
export type RollbarResourceInput = { kind: 'list' } | { kind: 'detail'; identifier: string }
export type RollbarResourceOutput = RollbarItem[] | RollbarItem

const validItem = (value: unknown): value is RollbarItem =>
  isRecord(value) && typeof value.integrationId === 'string' && typeof value.identifier === 'string' && typeof value.title === 'string'

function parseRollbar(raw: unknown, ref: ExternalRef): CodecResult<RollbarCached> {
  if (isRecord(raw) && raw.schemaVersion === 1 && validItem(raw.summary)) {
    return {
      ok: true,
      migrated: false,
      value: {
        ref: isRecord(raw.ref) ? (raw.ref as ExternalRef) : ref,
        summary: raw.summary,
        detail: validItem(raw.detail) ? raw.detail : undefined,
        listFetchedAt: typeof raw.listFetchedAt === 'number' ? raw.listFetchedAt : undefined,
        detailFetchedAt: typeof raw.detailFetchedAt === 'number' ? raw.detailFetchedAt : undefined,
        schemaVersion: 1,
        deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : undefined,
        truncated: raw.truncated === true,
      },
    }
  }
  if (validItem(raw)) return { ok: true, migrated: true, value: { ref, summary: raw, detail: raw, schemaVersion: 1 } }
  return { ok: false, error: 'invalid_rollbar_cache' }
}

const rollbarCodec: CachedItemCodec<RollbarItem, RollbarItem, RollbarItem> = {
  schemaVersion: 1,
  parse: parseRollbar,
  mergeSummary(existing, ref, summary, fetchedAt) {
    return { ref, summary, detail: existing?.detail, detailFetchedAt: existing?.detailFetchedAt, listFetchedAt: fetchedAt, schemaVersion: 1 }
  },
  withDetail(ref, summary, detail, fetchedAt) {
    return { ref, summary, detail, listFetchedAt: fetchedAt, detailFetchedAt: fetchedAt, schemaVersion: 1 }
  },
  // Rollbar list and detail currently share one public shape; the newest summary wins.
  toPublic: (item) => item.summary,
  summary: (item) => item.summary,
}

export const rollbarItemFromApi = (integrationId: string, raw: RollbarApiItem): RollbarItem => ({
  integrationId,
  identifier: String(raw.counter),
  title: raw.title,
  level: levelName(raw.level),
  environment: raw.environment,
  status: raw.status,
  totalOccurrences: raw.total_occurrences,
  firstOccurrenceAt: raw.first_occurrence_timestamp ? raw.first_occurrence_timestamp * 1000 : null,
  lastOccurrenceAt: raw.last_occurrence_timestamp ? raw.last_occurrence_timestamp * 1000 : null,
})

const resourceKey = (connectionId: string, input: RollbarResourceInput) =>
  `provider:rollbar:${connectionId}:items:${input.kind === 'list' ? 'list' : input.identifier}`

async function persistItem(
  context: Parameters<MirroredResourceContribution<RollbarResourceInput, RollbarResourceOutput>['refresh']>[0],
  item: RollbarItem,
  detail: boolean,
): Promise<void> {
  const ref = { providerId: 'rollbar', connectionId: item.integrationId, displayId: item.identifier }
  const [previous] = await context.db
    .select()
    .from(schema.issues)
    .where(and(eq(schema.issues.userId, context.userId), eq(schema.issues.integrationId, item.integrationId), eq(schema.issues.identifier, item.identifier)))
  const parsed = previous ? parseCached(rollbarCodec, previous.data, ref) : null
  const cached = detail
    ? rollbarCodec.withDetail(ref, item, item, context.now)
    : rollbarCodec.mergeSummary(parsed?.ok ? parsed.value : null, ref, item, context.now)
  const data = encodeCached(cached, context.limits.maxCachedItemBytes)
  await context.db
    .insert(schema.issues)
    .values({ userId: context.userId, integrationId: item.integrationId, provider: 'rollbar', identifier: item.identifier, data, fetchedAt: context.now })
    .onConflictDoUpdate({
      target: [schema.issues.userId, schema.issues.integrationId, schema.issues.identifier],
      set: { data, fetchedAt: context.now },
    })
}

const rollbarItemsResource: MirroredResourceContribution<RollbarResourceInput, RollbarResourceOutput> = {
  id: 'rollbar.items',
  ttlMs: 2 * 60_000,
  merge: 'summary-preserves-detail',
  key: resourceKey,
  async read(context, input) {
    if (input.kind === 'detail') {
      const [row] = await context.db
        .select()
        .from(schema.issues)
        .where(and(
          eq(schema.issues.userId, context.userId),
          eq(schema.issues.integrationId, context.connection.id),
          eq(schema.issues.identifier, input.identifier),
        ))
      if (!row) return null
      const parsed = parseCached(rollbarCodec, row.data, {
        providerId: 'rollbar', connectionId: context.connection.id, displayId: input.identifier,
      })
      return parsed.ok ? { data: rollbarCodec.toPublic(parsed.value), fetchedAt: row.fetchedAt } : null
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
    const items = rows.flatMap((row) => {
      const parsed = parseCached(rollbarCodec, row.data, {
        providerId: 'rollbar', connectionId: row.integrationId, displayId: row.identifier,
      })
      return parsed.ok ? [rollbarCodec.toPublic(parsed.value)] : []
    })
    const fetchedAt = state[0]?.fetchedAt ?? (rows.length ? Math.min(...rows.map((row) => row.fetchedAt)) : null)
    return fetchedAt == null ? null : { data: items, fetchedAt }
  },
  async refresh(context, input) {
    try {
      const response = await rollbarFetch(context.secret, input.kind === 'list' ? itemsPath : itemByCounterPath(input.identifier))
      if (response.status === 401 || response.status === 403) return { ok: false, failure: { error: 'provider_needs_auth', status: 401 } }
      if (response.status === 429) return { ok: false, failure: { error: 'provider_rate_limited', status: 429 } }
      if (response.status === 404) return { ok: false, failure: { error: 'provider_resource_not_found', status: 404 } }
      if (!response.ok) return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }

      if (input.kind === 'detail') {
        const item = rollbarItemFromApi(context.connection.id, await rollbarData<RollbarApiItem>(response))
        await persistItem(context, item, true)
        return { ok: true }
      }

      const { items: rawItems } = await rollbarData<{ items: RollbarApiItem[] }>(response)
      const items = rawItems.map((raw) => rollbarItemFromApi(context.connection.id, raw))
      for (const item of items) await persistItem(context, item, false)
      const identifiers = items.map((item) => item.identifier)
      const owned = and(
        eq(schema.issues.userId, context.userId),
        eq(schema.issues.integrationId, context.connection.id),
        eq(schema.issues.provider, 'rollbar'),
      )
      await context.db.delete(schema.issues).where(identifiers.length ? and(owned, notInArray(schema.issues.identifier, identifiers)) : owned)
      const key = resourceKey(context.connection.id, input)
      await context.db
        .insert(schema.syncState)
        .values({ userId: context.userId, resource: key, fetchedAt: context.now })
        .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: context.now } })
      return { ok: true }
    } catch {
      return { ok: false, failure: { error: 'provider_unavailable', status: 502 } }
    }
  },
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
  resources: [rollbarItemsResource],
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
    legacyCache: {
      integrationId: 'rollbar-test', identifier: '142', title: 'TypeError', level: 'error', environment: 'prod',
      status: 'active', totalOccurrences: 3, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
    } satisfies RollbarItem,
    summary: {
      integrationId: 'rollbar-test', identifier: '142', title: 'TypeError updated', level: 'error', environment: 'prod',
      status: 'active', totalOccurrences: 4, firstOccurrenceAt: 1, lastOccurrenceAt: 3,
    } satisfies RollbarItem,
    detail: {
      integrationId: 'rollbar-test', identifier: '142', title: 'TypeError', level: 'error', environment: 'prod',
      status: 'active', totalOccurrences: 3, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
    } satisfies RollbarItem,
  },
})
