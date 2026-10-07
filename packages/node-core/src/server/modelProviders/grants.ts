// A loaded plugin's model grant and its daily allowance (docs/integrations/model-providers.md § Plugin
// model grants).
//
// The owner picks a backend, a model and a daily output-token allowance for one plugin. A call from that
// plugin that names no backend spends the grant. A call that names one behaves as it always has, and is
// only recorded. So the allowance bounds the omitted-backend path, not everything the broad `models`
// permission lets a plugin spend.
//
// Admission is one synchronous SQLite transaction: sum the day's charges and open reservations, refuse
// past the allowance, write this call's reservation. The provider call runs after it commits, never
// inside it. Accounting is conservative: a reservation is released only for a refusal that happened
// before anything was generated, and a crash leaves it charged in full.
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { HARNESS_BACKEND_PREFIX, type ModelBackend, type PluginModelGrantState } from '@acorn/protocol/modelProviders.ts'
import type { ProviderErrorCode } from '@acorn/protocol/integrations.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { GenerateTextRequest, ModelService, PluginGenerateTextRequest } from '../core/models'
import type { IdentityService } from '../core/identity'
import { isProviderOperationError, ProviderOperationError } from '../integrations/types'
import { DEFAULT_TIMEOUT_MS, validateInput } from './runtime'
import type { GenerateTextResult } from './types'

// What one agent CLI call counts as. A CLI has no output-token flag, so its bound is a call-count
// estimate, shown in settings, and never described as a token ceiling.
export const HARNESS_CALL_ESTIMATE = 4_000

// Refusals that happen before a provider generates anything, so their reservation goes back. Every
// other failure, including a timeout, a cancellation and an unavailable provider, stays charged.
const REFUSED_BEFORE_GENERATION: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
  'provider_not_connected', 'provider_needs_auth', 'provider_bad_config', 'provider_secret_unreadable',
])

export type PluginModelGrant = { backendId: string; modelId: string; dailyOutputTokens: number }

/** `YYYY-MM-DD` in the Node's own time zone. */
export const localDay = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const grantKey = (ownerId: string, pluginId: string) =>
  and(eq(schema.pluginModelGrants.ownerId, ownerId), eq(schema.pluginModelGrants.pluginId, pluginId))

export function readModelGrant(db: AppDatabase, ownerId: string, pluginId: string): PluginModelGrant | null {
  const row = db.select().from(schema.pluginModelGrants).where(grantKey(ownerId, pluginId)).get()
  return row ? { backendId: row.backendId, modelId: row.modelId, dailyOutputTokens: row.dailyOutputTokens } : null
}

// A changed grant applies to the next call. A call already admitted keeps the backend and day it was
// admitted with, and its reservation still counts.
export function writeModelGrant(db: AppDatabase, ownerId: string, pluginId: string, grant: PluginModelGrant): void {
  const values = { ...grant, updatedAt: Date.now() }
  db.insert(schema.pluginModelGrants).values({ ownerId, pluginId, ...values })
    .onConflictDoUpdate({ target: [schema.pluginModelGrants.ownerId, schema.pluginModelGrants.pluginId], set: values }).run()
}

export function deleteModelGrant(db: AppDatabase, ownerId: string, pluginId: string): void {
  db.delete(schema.pluginModelGrants).where(grantKey(ownerId, pluginId)).run()
}

const calls = schema.pluginModelCalls
// An open reservation counts in full until it settles.
const spentSql = sql<number>`coalesce(sum(case when ${calls.status} = 'reserved' then ${calls.reservedUnits} else coalesce(${calls.chargedUnits}, 0) end), 0)`

export function dayUsage(db: AppDatabase, ownerId: string, pluginId: string, day: string): PluginModelGrantState['usage'] {
  const scope = and(eq(calls.ownerId, ownerId), eq(calls.pluginId, pluginId), eq(calls.day, day))
  const granted = db.select({
    spent: spentSql,
    reserved: sql<number>`coalesce(sum(case when ${calls.status} = 'reserved' then ${calls.reservedUnits} else 0 end), 0)`,
    calls: sql<number>`count(*)`,
    reported: sql<number>`coalesce(sum(${calls.reportedOutputTokens}), 0)`,
  }).from(calls).where(and(scope, eq(calls.path, 'granted'))).get()
  const explicit = db.select({ calls: sql<number>`count(*)`, reported: sql<number>`coalesce(sum(${calls.reportedOutputTokens}), 0)` })
    .from(calls).where(and(scope, eq(calls.path, 'explicit'))).get()
  return {
    spent: granted?.spent ?? 0,
    reserved: granted?.reserved ?? 0,
    calls: granted?.calls ?? 0,
    reportedOutputTokens: granted?.reported ?? 0,
    explicitCalls: explicit?.calls ?? 0,
    explicitReportedOutputTokens: explicit?.reported ?? 0,
  }
}

/** What Settings shows for one plugin. `backends` is the owner's `models.available()` list. */
export function modelGrantState(
  db: AppDatabase, ownerId: string, pluginId: string, backends: ModelBackend[], now = Date.now(),
): PluginModelGrantState {
  const grant = readModelGrant(db, ownerId, pluginId)
  const day = localDay(now)
  const usage = dayUsage(db, ownerId, pluginId, day)
  const status = !grant ? 'unconfigured'
    : !backends.some((backend) => backend.id === grant.backendId) ? 'backend-missing'
    : usage.spent >= grant.dailyOutputTokens ? 'exhausted'
    : 'ready'
  return { grant, status, day, usage, backends, harnessCallEstimate: HARNESS_CALL_ESTIMATE }
}

/** Why the owner can't save this grant, or null. Checked on the Node, never trusted from the client. */
export function modelGrantProblem(grant: PluginModelGrant, backends: ModelBackend[]): string | null {
  const backend = backends.find((candidate) => candidate.id === grant.backendId)
  if (!backend) return 'That backend isn\'t available on this Node. Connect it, or install its CLI, first.'
  // A CLI whose catalog couldn't be read keeps a saved model, the same rule the picker applies.
  if (grant.modelId && !backend.catalogUnavailable && !backend.models.some((model) => model.id === grant.modelId)) {
    return `${backend.label} has no model named ${grant.modelId}.`
  }
  return null
}

/** Admit one granted call, or throw `provider_budget_exhausted`. Returns the reservation's id. */
export function reserveModelCall(db: AppDatabase, args: {
  ownerId: string
  pluginId: string
  backendId: string
  units: number
  dailyOutputTokens: number
  now?: number
}): string {
  const now = args.now ?? Date.now()
  const day = localDay(now)
  const id = randomUUID()
  db.transaction((tx) => {
    const spent = tx.select({ spent: spentSql }).from(calls)
      .where(and(eq(calls.ownerId, args.ownerId), eq(calls.pluginId, args.pluginId), eq(calls.day, day), eq(calls.path, 'granted')))
      .get()?.spent ?? 0
    if (spent + args.units > args.dailyOutputTokens) {
      throw new ProviderOperationError('provider_budget_exhausted', 429,
        `${args.pluginId} has used its model allowance for today. The owner can raise it on its page in Settings > Plugins, or wait until midnight on this Node.`)
    }
    tx.insert(calls).values({
      id, ownerId: args.ownerId, pluginId: args.pluginId, day, path: 'granted', backendId: args.backendId,
      status: 'reserved', reservedUnits: args.units, createdAt: now,
    }).run()
  })
  return id
}

type Usage = GenerateTextResult['usage']
const reported = (usage: Usage) => ({
  reportedInputTokens: usage?.inputTokens ?? null,
  reportedOutputTokens: usage?.outputTokens ?? null,
})

export function settleModelCall(db: AppDatabase, id: string, chargedUnits: number, usage?: Usage): void {
  db.update(calls).set({ status: 'settled', chargedUnits, ...reported(usage), settledAt: Date.now() })
    .where(and(eq(calls.id, id), eq(calls.status, 'reserved'))).run()
}

export function releaseModelCall(db: AppDatabase, id: string): void {
  db.update(calls).set({ status: 'released', chargedUnits: 0, settledAt: Date.now() })
    .where(and(eq(calls.id, id), eq(calls.status, 'reserved'))).run()
}

const notConfigured = (pluginId: string, detail: string) =>
  new ProviderOperationError('provider_not_configured', 400, `${detail} The owner chooses one on its page in Settings > Plugins.`)

/**
 * The models facet a loaded plugin receives, bound to its id by the host (../plugins/permissions.ts).
 * Never take a plugin id from the request: the binding is the whole point.
 */
export function pluginModelService(db: AppDatabase, models: ModelService, identity: IdentityService, pluginId: string) {
  const explicit = async (request: GenerateTextRequest): Promise<GenerateTextResult> => {
    let usage: Usage
    try {
      const result = await models.generateText(request)
      usage = result.usage
      return result
    } finally {
      // Recorded, never limited. Same behaviour as before grants existed.
      const now = Date.now()
      db.insert(calls).values({
        id: randomUUID(), ownerId: identity.active() ?? request.userId, pluginId, day: localDay(now), path: 'explicit',
        backendId: request.backendId, status: 'settled', reservedUnits: 0, chargedUnits: 0,
        ...reported(usage), createdAt: now, settledAt: now,
      }).run()
    }
  }

  const granted = async (request: PluginGenerateTextRequest): Promise<GenerateTextResult> => {
    const owner = identity.active()
    if (!owner) throw notConfigured(pluginId, 'This Node has no owner yet.')
    if (request.userId !== owner) {
      throw new ProviderOperationError('provider_bad_config', 400, 'userId must be this Node\'s owner, from ctx.core.identity.active().')
    }
    validateInput(request.input, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const grant = readModelGrant(db, owner, pluginId)
    if (!grant) throw notConfigured(pluginId, `${pluginId} has no model to generate with.`)
    if (request.input.modelId !== undefined && request.input.modelId.trim() !== grant.modelId) {
      throw new ProviderOperationError('provider_bad_config', 400, `The owner chose ${pluginId}'s model. Leave modelId out, or name a backend.`)
    }
    const harness = grant.backendId.startsWith(HARNESS_BACKEND_PREFIX)
    const units = harness ? HARNESS_CALL_ESTIMATE : request.input.maxOutputTokens
    const callId = reserveModelCall(db, {
      ownerId: owner, pluginId, backendId: grant.backendId, units, dailyOutputTokens: grant.dailyOutputTokens,
    })
    let result: GenerateTextResult
    try {
      const { modelId: _requested, ...input } = request.input
      result = await models.generateText({
        ...request, backendId: grant.backendId, input: grant.modelId ? { ...input, modelId: grant.modelId } : input,
      })
    } catch (error) {
      if (isProviderOperationError(error) && REFUSED_BEFORE_GENERATION.has(error.code)) releaseModelCall(db, callId)
      else settleModelCall(db, callId, units)
      throw error
    }
    // A connection is charged what it reports, or the whole reservation when it reports nothing. A CLI
    // is always charged its estimate; what it reports is kept beside the charge.
    const outputTokens = result.usage?.outputTokens
    settleModelCall(db, callId, harness || outputTokens === undefined ? units : outputTokens, result.usage)
    return result
  }

  return {
    generateText: (request: PluginGenerateTextRequest): Promise<GenerateTextResult> =>
      request.backendId === undefined ? granted(request) : explicit(request as GenerateTextRequest),
    available: (userId: string) => models.available(userId),
  }
}
