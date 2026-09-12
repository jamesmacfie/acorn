import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, or } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { ToolCeiling } from '@acorn/protocol/workflow.ts'
import * as schema from '../../node/schema'

export type AgentSpawnState = 'creating' | 'provisioned' | 'failed'
export type AgentSpawnIsolation = 'shared' | 'worktree'

export type AgentSpawn = {
  id: string
  rootTaskId: string
  rootSessionId: string
  ownerTaskId: string
  ownerSessionId: string
  parentSpawnId: string | null
  childTaskId: string
  childSessionId: string | null
  childTurnId: string | null
  depth: number
  isolation: AgentSpawnIsolation
  provisioningState: AgentSpawnState
  provisioning: AgentSpawnProvisioning | null
  idempotencyKey: string
  error: string | null
  createdAt: number
  updatedAt: number
}

export type AgentSpawnProvisioning = {
  title: string
  prompt: string
  branch: string
  providerId: string
  profileId: string
  parentSessionId: string | null
  parentTurnId: string | null
  toolCeiling: ToolCeiling
  resultSchema?: object
  configOptions?: Record<string, string>
}

export type AgentDelegationVisibility = {
  sessionId: string
  ownerTaskId: string
  ownerSessionId: string
  managedParentSessionId: string | null
  depth: number
  isolation: AgentSpawnIsolation
}

const TERMINAL_SESSION_STATES = new Set(['stopped', 'failed', 'archived'])
const MAX_DELEGATION_DEPTH = 2
const MAX_LIVE_DESCENDANTS = 12
const MAX_PROVISIONING_ERROR_CHARS = 2_000

const mapSpawn = (row: typeof schema.agentSpawns.$inferSelect): AgentSpawn => ({
  id: row.id,
  rootTaskId: row.rootTaskId,
  rootSessionId: row.rootSessionId,
  ownerTaskId: row.ownerTaskId,
  ownerSessionId: row.ownerSessionId,
  parentSpawnId: row.parentSpawnId,
  childTaskId: row.childTaskId,
  childSessionId: row.childSessionId,
  childTurnId: row.childTurnId,
  depth: row.depth,
  isolation: row.isolation as AgentSpawnIsolation,
  provisioningState: row.provisioningState as AgentSpawnState,
  provisioning: parseProvisioning(row.provisioningJson),
  idempotencyKey: row.idempotencyKey,
  error: row.error,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const parseProvisioning = (value: string | null): AgentSpawnProvisioning | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<AgentSpawnProvisioning>
    if (
      typeof parsed.title !== 'string'
      || typeof parsed.prompt !== 'string'
      || typeof parsed.branch !== 'string'
      || typeof parsed.providerId !== 'string'
      || typeof parsed.profileId !== 'string'
      || (parsed.parentSessionId !== null && typeof parsed.parentSessionId !== 'string')
      || (parsed.parentTurnId !== null && typeof parsed.parentTurnId !== 'string')
      || !parsed.toolCeiling
      || typeof parsed.toolCeiling !== 'object'
    ) return null
    return parsed as AgentSpawnProvisioning
  } catch {
    return null
  }
}

export class DelegationLimitError extends Error {
  constructor(public readonly code: 'max_depth' | 'live_limit', message: string) {
    super(message)
    this.name = 'DelegationLimitError'
  }
}

/**
 * The ownership and provisioning repository for agent-driven orchestration.
 *
 * The reservation transaction is the admission lock. It derives lineage from the signed caller's
 * child row, counts creating reservations and nonterminal child sessions, then inserts the new slot
 * without yielding to another call.
 */
export class AgentDelegationStore {
  constructor(private readonly db: PluginDatabase) {}

  reserveShared(input: {
    ownerTaskId: string
    ownerSessionId: string
    idempotencyKey: string
  }): { spawn: AgentSpawn; created: boolean } {
    return this.reserve({ ...input, isolation: 'shared', childTaskId: input.ownerTaskId, provisioning: null })
  }

  reserveWorktree(input: {
    ownerTaskId: string
    ownerSessionId: string
    idempotencyKey: string
    provisioning: AgentSpawnProvisioning
  }): { spawn: AgentSpawn; created: boolean } {
    return this.reserve({
      ...input,
      isolation: 'worktree',
      childTaskId: randomUUID(),
    })
  }

  private reserve(input: {
    ownerTaskId: string
    ownerSessionId: string
    idempotencyKey: string
    isolation: AgentSpawnIsolation
    childTaskId: string
    provisioning: AgentSpawnProvisioning | null
  }): { spawn: AgentSpawn; created: boolean } {
    const spawnId = randomUUID()
    const timestamp = Date.now()
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.agentSpawns)
        .where(and(
          eq(schema.agentSpawns.ownerTaskId, input.ownerTaskId),
          eq(schema.agentSpawns.ownerSessionId, input.ownerSessionId),
          eq(schema.agentSpawns.idempotencyKey, input.idempotencyKey),
        ))
        .get()
      if (existing) return { spawn: mapSpawn(existing), created: false }

      const parent = tx
        .select()
        .from(schema.agentSpawns)
        .where(and(
          eq(schema.agentSpawns.childTaskId, input.ownerTaskId),
          eq(schema.agentSpawns.childSessionId, input.ownerSessionId),
          eq(schema.agentSpawns.provisioningState, 'provisioned'),
        ))
        .orderBy(desc(schema.agentSpawns.createdAt))
        .get()
      const depth = parent ? parent.depth + 1 : 1
      if (depth > MAX_DELEGATION_DEPTH) {
        throw new DelegationLimitError('max_depth', `Delegation depth is limited to ${MAX_DELEGATION_DEPTH}.`)
      }
      const rootTaskId = parent?.rootTaskId ?? input.ownerTaskId
      const rootSessionId = parent?.rootSessionId ?? input.ownerSessionId

      const descendants = tx
        .select({
          provisioningState: schema.agentSpawns.provisioningState,
          runtimeState: schema.agentSessions.runtimeState,
        })
        .from(schema.agentSpawns)
        .leftJoin(schema.agentSessions, eq(schema.agentSessions.id, schema.agentSpawns.childSessionId))
        .where(and(
          eq(schema.agentSpawns.rootTaskId, rootTaskId),
          eq(schema.agentSpawns.rootSessionId, rootSessionId),
        ))
        .all()
      const liveCount = descendants.filter((row) =>
        row.provisioningState === 'creating'
        || (row.provisioningState === 'provisioned'
          && row.runtimeState != null
          && !TERMINAL_SESSION_STATES.has(row.runtimeState)),
      ).length
      if (liveCount >= MAX_LIVE_DESCENDANTS) {
        throw new DelegationLimitError(
          'live_limit',
          `A delegation tree may have at most ${MAX_LIVE_DESCENDANTS} live descendants.`,
        )
      }

      const values: typeof schema.agentSpawns.$inferInsert = {
        id: spawnId,
        rootTaskId,
        rootSessionId,
        ownerTaskId: input.ownerTaskId,
        ownerSessionId: input.ownerSessionId,
        parentSpawnId: parent?.id ?? null,
        childTaskId: input.childTaskId,
        childSessionId: null,
        childTurnId: null,
        depth,
        isolation: input.isolation,
        provisioningState: 'creating',
        provisioningJson: input.provisioning ? JSON.stringify(input.provisioning) : null,
        idempotencyKey: input.idempotencyKey,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      tx.insert(schema.agentSpawns).values(values).run()
      const created = tx.select().from(schema.agentSpawns).where(eq(schema.agentSpawns.id, spawnId)).get()
      if (!created) throw new Error('Agent spawn reservation was not persisted.')
      return { spawn: mapSpawn(created), created: true }
    })
  }

  async creatingWorktrees(): Promise<AgentSpawn[]> {
    const rows = await this.db
      .select()
      .from(schema.agentSpawns)
      .where(and(
        eq(schema.agentSpawns.isolation, 'worktree'),
        eq(schema.agentSpawns.provisioningState, 'creating'),
      ))
      .orderBy(schema.agentSpawns.createdAt)
    return rows.map(mapSpawn)
  }

  async get(id: string): Promise<AgentSpawn | null> {
    const [row] = await this.db.select().from(schema.agentSpawns).where(eq(schema.agentSpawns.id, id)).limit(1)
    return row ? mapSpawn(row) : null
  }

  async forCall(ownerTaskId: string, ownerSessionId: string, idempotencyKey: string): Promise<AgentSpawn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentSpawns)
      .where(and(
        eq(schema.agentSpawns.ownerTaskId, ownerTaskId),
        eq(schema.agentSpawns.ownerSessionId, ownerSessionId),
        eq(schema.agentSpawns.idempotencyKey, idempotencyKey),
      ))
      .limit(1)
    return row ? mapSpawn(row) : null
  }

  async complete(id: string, childSessionId: string, childTurnId: string): Promise<AgentSpawn> {
    const timestamp = Date.now()
    await this.db
      .update(schema.agentSpawns)
      .set({ childSessionId, childTurnId, provisioningState: 'provisioned', error: null, updatedAt: timestamp })
      .where(eq(schema.agentSpawns.id, id))
    const spawn = await this.get(id)
    if (!spawn) throw new Error(`Agent spawn disappeared during provisioning: ${id}`)
    return spawn
  }

  /** Persist the first cross-database repair anchor while the initial turn is still being created. */
  async recordSession(id: string, childSessionId: string): Promise<void> {
    await this.db
      .update(schema.agentSpawns)
      .set({ childSessionId, updatedAt: Date.now() })
      .where(and(
        eq(schema.agentSpawns.id, id),
        eq(schema.agentSpawns.provisioningState, 'creating'),
      ))
  }

  async fail(
    id: string,
    error: unknown,
    child: { sessionId?: string; turnId?: string } = {},
  ): Promise<AgentSpawn> {
    const detail = (error instanceof Error ? error.message : 'Agent spawn provisioning failed.')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, MAX_PROVISIONING_ERROR_CHARS)
    await this.db
      .update(schema.agentSpawns)
      .set({
        provisioningState: 'failed',
        error: detail,
        ...(child.sessionId ? { childSessionId: child.sessionId } : {}),
        ...(child.turnId ? { childTurnId: child.turnId } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(schema.agentSpawns.id, id))
    const spawn = await this.get(id)
    if (!spawn) throw new Error(`Agent spawn disappeared while recording failure: ${id}`)
    return spawn
  }

  async ownedChild(ownerTaskId: string, ownerSessionId: string, childSessionId: string): Promise<AgentSpawn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentSpawns)
      .where(and(
        eq(schema.agentSpawns.ownerTaskId, ownerTaskId),
        eq(schema.agentSpawns.ownerSessionId, ownerSessionId),
        eq(schema.agentSpawns.childSessionId, childSessionId),
        eq(schema.agentSpawns.provisioningState, 'provisioned'),
      ))
      .limit(1)
    return row ? mapSpawn(row) : null
  }

  /**
   * Resolve only the spawn rows belonging to sessions already admitted to a list response.
   *
   * `delegationSpawnId` covers the short provisioning window before `child_session_id` is written.
   * The task equality is checked again after the query so a corrupted config value cannot project
   * another task's authority row into this page.
   */
  async visibilityForSessions(
    sessions: readonly Pick<AgentSession, 'id' | 'taskId' | 'parentSessionId' | 'config'>[],
  ): Promise<AgentDelegationVisibility[]> {
    if (!sessions.length) return []
    const sessionIds = sessions.map((session) => session.id)
    const spawnIds = sessions.flatMap((session) =>
      typeof session.config.delegationSpawnId === 'string' ? [session.config.delegationSpawnId] : [])
    const rows = await this.db
      .select()
      .from(schema.agentSpawns)
      .where(or(
        inArray(schema.agentSpawns.childSessionId, sessionIds),
        ...(spawnIds.length ? [inArray(schema.agentSpawns.id, spawnIds)] : []),
      ))
    const byChild = new Map(rows.flatMap((row) => row.childSessionId ? [[row.childSessionId, row]] : []))
    const bySpawn = new Map(rows.map((row) => [row.id, row]))
    return sessions.flatMap((session) => {
      const spawnId = typeof session.config.delegationSpawnId === 'string'
        ? session.config.delegationSpawnId
        : null
      const row = byChild.get(session.id) ?? (spawnId ? bySpawn.get(spawnId) : undefined)
      if (!row || row.childTaskId !== session.taskId) return []
      return [{
        sessionId: session.id,
        ownerTaskId: row.ownerTaskId,
        ownerSessionId: row.ownerSessionId,
        managedParentSessionId: session.parentSessionId === row.ownerSessionId ? row.ownerSessionId : null,
        depth: row.depth,
        isolation: row.isolation as AgentSpawnIsolation,
      }]
    })
  }
}

export const delegationLimits = {
  maxDepth: MAX_DELEGATION_DEPTH,
  maxLiveDescendants: MAX_LIVE_DESCENDANTS,
} as const
