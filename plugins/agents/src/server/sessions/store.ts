import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNotNull, isNull, like, lt, ne, notExists, notInArray, or, sql } from 'drizzle-orm'
import type { CoreServices, PluginDatabase, SearchHit } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type {
  AgentEventPage,
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentRequest,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentSubagent,
  AgentTurn,
  AgentWaitCondition,
  AgentWaitFacts,
} from '../../contract/wire.ts'
import { AGENT_EVENT_SCHEMA_VERSION, agentEventSearchText } from '../../contract/wire.ts'
import type { AgentLifecyclePublisher, AgentSessionChange, SessionRenameSource } from '../../contract/lifecycle'
import type { CreateAgentSessionInput, EnqueueAgentTurnInput } from '../../shared/schemas'
import type { CheckResults } from '../../shared/delegationSchemas'
import { sessionCursor, type SessionListFilter } from '../../shared/sessionList'
import type { RemovedArtifactObject } from './artifactStore'
import { persistedAttendance, resolveAttendance, sessionAttendance, type TurnAttendanceContext, type WorkflowPosture } from './attendance'
import { continuesStream, isAppendDelta } from './durableEventBuffer'
import { readExecutionCapture } from './executionCapture'
import { LedgerFold } from './ledgerFold'
import { AgentLifecycle } from './lifecycle'
import { clientEventRecord, mapAgentEvent, mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'
import type { AgentSearchProjection } from './searchProjection'
import type { HistoryHit, HistoryPage, HistoryRole } from './sessionHistory'
import type { SessionSearchFilter } from './sessionSearch'
import { DEFAULT_SESSION_TITLE, deterministicSessionTitle, normalizeStoredSessionTitle } from './sessionTitle'
import { eventSubagentId, foldSubagentRoster, isActiveSubagent, projectAgentEvent, touchSubagentRoster } from './stateMachine'
import { effectiveTurnPolicy } from './turnPolicy'
import { readWaitFacts } from './waitFacts'

const now = (): number => Date.now()

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

/** The files a removed session leaves behind, which the runtime collects after the transaction. */
export type RemovedSessionObjects = { attachmentIds: string[]; artifactObjects: RemovedArtifactObject[] }

// Tolerant on purpose: a roster that cannot be decoded starts over rather than failing the event
// insert. Losing the roster costs a sidebar row; failing the insert loses the transcript.
const parseSubagents = (value: string | null): AgentSubagent[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as AgentSubagent[] : []
  } catch {
    return []
  }
}

// `undefined` in, `undefined` out, because the column is only written when something changed.
const jsonOrUndefined = (roster: AgentSubagent[] | undefined): string | undefined =>
  roster ? JSON.stringify(roster) : undefined

export type EnqueueTurnOutcome = {
  turn: AgentTurn
  inserted: boolean
  firstTurnFallback: string | null
  sessionAfterRename: AgentSession | null
}

const eventReadColumns = (client: boolean) => ({
  ...getTableColumns(schema.agentEvents),
  ...(client ? { searchText: sql<null>`NULL` } : {}),
})

/**
 * The one owner of this plugin's session tables: sessions, turns, events, requests, and the
 * operation records that make commands idempotent. Deleting a session also removes the attachment
 * references and artifact rows it owns, in the same transaction.
 *
 * The event transaction lives here because it is the authority that advances the session sequence
 * and all query projections atomically. It appends, and folds a tool call's or a file change's
 * superseded rows into the new one in the same step (./ledgerFold.ts).
 *
 * See docs/managed-agents/sessions.md § Session model for how a workspace-scoped read resolves task ids
 * through core before filtering this plugin's own tables.
 */
export class AgentStore {
  private readonly lifecycle: AgentLifecycle
  private searchProjectionPromise: Promise<AgentSearchProjection> | undefined
  // Which rows each open tool call and file change has, so an update can supersede them (./ledgerFold.ts).
  private readonly ledgerFold = new LedgerFold()

  constructor(
    private readonly db: PluginDatabase,
    private readonly core: CoreServices,
    publishLifecycle?: AgentLifecyclePublisher,
  ) {
    this.lifecycle = new AgentLifecycle(db, publishLifecycle)
  }

  // `null` means no workspace filter. An empty array means the workspace has no tasks, so the query
  // narrows to nothing rather than falling through to unfiltered.
  private async workspaceTaskIds(workspaceId: string | undefined): Promise<string[] | null> {
    if (!workspaceId) return null
    return this.core.tasks.idsForWorkspace(workspaceId)
  }

  async getSession(id: string): Promise<AgentSession | null> {
    const [row] = await this.db.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, id)).limit(1)
    return row ? mapAgentSession(row) : null
  }

  async requireSession(id: string): Promise<AgentSession> {
    const session = await this.getSession(id)
    if (!session) throw new Error(`Managed agent session not found: ${id}`)
    return session
  }

  async recordEvent(sessionId: string, turnId: string | null, event: AgentNormalizedEvent): Promise<AgentEventRecord> {
    await this.ensureSearchProjection()
    const commands = event.type === 'tool' && event.tool.kind === 'execute' && turnId === null
      ? await import('./commandLifecycle') : null
    const timestamp = now()
    const eventId = randomUUID()
    const committed = this.db.transaction((tx) => {
      if (event.type === 'tool' && event.tool.kind === 'execute' && turnId === null) {
        turnId = commands!.commandTurn(tx, sessionId, event.tool)
      }
      const turn = turnId ? tx.select({ status: schema.agentTurns.status }).from(schema.agentTurns)
        .where(eq(schema.agentTurns.id, turnId)).get() : undefined
      // Attribution keeps a late update on its card; only an active turn can claim parent work.
      const lifecycleEnding = event.type === 'tool' && ['interrupted', 'cancelled', 'unknown'].includes(event.tool.status ?? '')
      const projection = lifecycleEnding ? {} : projectAgentEvent(event,
        turn && ['dispatching', 'active'].includes(turn.status) && !eventSubagentId(event) ? turnId : null)
      const current = tx
        .select({
          lastEventSeq: schema.agentSessions.lastEventSeq,
          configJson: schema.agentSessions.configJson,
          subagentsJson: schema.agentSessions.subagentsJson,
          kind: schema.agentSessions.kind,
          taskId: schema.agentSessions.taskId,
        })
        .from(schema.agentSessions)
        .where(eq(schema.agentSessions.id, sessionId))
        .get()
      if (!current) throw new Error(`Managed agent session not found: ${sessionId}`)
      // A workflow's session answers to its run, not to the owner. A finished or failed step is the
      // run's news, told once by the workflows plugin as run-done or run-failed, so only a request the
      // agent is waiting on reaches the owner from here.
      const attention = current.kind === 'workflow' && (projection.attention === 'completed' || projection.attention === 'error')
        ? 'none'
        : projection.attention
      const seq = current.lastEventSeq + 1
      const configJson = event.type === 'session_metadata'
        ? JSON.stringify({
            ...JSON.parse(current.configJson) as Record<string, unknown>,
            ...(event.configOptions ? { configOptions: event.configOptions } : {}),
            ...(event.commands ? { commands: event.commands } : {}),
            ...(event.skills ? { skills: event.skills } : {}),
          })
        : projection.configJson
      // The subagent roster projected onto the row in the same transaction as the event insert, so a
      // reader can never see a roster that disagrees with the ledger it was folded from. It is on the
      // row rather than in a table of its own because runtimeEngine.record() broadcasts the row
      // whenever an event changes it, which is what makes the sidebar's sub-rows live for a session nobody
      // has opened (docs/managed-agents/subagents.md § Subagents).
      // An event the harness attributed to a child marks that child heard from, which is what keeps a
      // backgrounded row honest: its own updates stop at the launch receipt, so without this the only
      // clock the roster has is one that stopped ticking minutes ago.
      const touchedId = event.type === 'subagent' || lifecycleEnding ? undefined : eventSubagentId(event)
      const roster = event.type === 'subagent'
        ? foldSubagentRoster(parseSubagents(current.subagentsJson), event.subagent, turnId, timestamp)
        : []
      const subagentsJson = event.type === 'subagent'
        ? JSON.stringify(roster)
        : touchedId
          ? jsonOrUndefined(touchSubagentRoster(parseSubagents(current.subagentsJson), touchedId, timestamp))
          : undefined
      tx.update(schema.agentSessions)
        .set({
          lastEventSeq: seq,
          lastEventAt: timestamp,
          updatedAt: timestamp,
          ...(projection.runtimeState ? { runtimeState: projection.runtimeState } : {}),
          ...(attention ? { attention } : {}),
          ...(projection.providerSessionRef ? { providerSessionRef: projection.providerSessionRef } : {}),
          ...(configJson ? { configJson } : {}),
          ...(subagentsJson ? { subagentsJson } : {}),
        })
        .where(eq(schema.agentSessions.id, sessionId))
        .run()

      // A tool call or file change update lands as the card's whole state, and the rows it supersedes
      // go in this transaction. The opener stays where it is, with no search text of its own, so the
      // call is indexed once (./ledgerFold.ts).
      const stream = this.streamTransition(tx, sessionId, current.lastEventSeq, turnId, event)
      const fold = this.ledgerFold.plan(tx, sessionId, turnId, event)
      const stored = fold?.stored ?? event
      const values: typeof schema.agentEvents.$inferInsert = {
        id: eventId,
        sessionId,
        turnId,
        seq,
        schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
        eventJson: JSON.stringify(stored),
        searchText: !fold && stream.continuation ? null : agentEventSearchText(stored),
        createdAt: timestamp,
      }
      tx.insert(schema.agentEvents).values(values).run()
      if (fold?.head) {
        if (fold.superseded.length) tx.delete(schema.agentEvents).where(inArray(schema.agentEvents.id, fold.superseded)).run()
        tx.update(schema.agentEvents)
          .set({ searchText: null })
          .where(and(eq(schema.agentEvents.id, fold.head), isNotNull(schema.agentEvents.searchText)))
          .run()
      }
      const changed = this.applyEventProjection(tx, sessionId, turnId, event, timestamp)
      return {
        // What the socket and the node's listeners get: the update as the provider reported it, so a
        // frame stays the size of the change. The stored row folds to the same card (./ledgerFold.ts).
        row: { ...values, eventJson: JSON.stringify(event), turnId: values.turnId ?? null, searchText: values.searchText ?? null },
        fold,
        stored,
        roster,
        taskId: current.taskId,
        streamClosed: stream.closed,
        ...changed,
      }
    })
    committed.fold?.commit(eventId)
    if (committed.streamClosed) await this.flushSearch(sessionId)
    if (committed.turnChanged && turnId) await this.lifecycle.announceTurn(turnId)
    if (committed.requestChanged && (event.type === 'request' || event.type === 'request_resolved')) {
      await this.lifecycle.announceRequest(sessionId, event.requestId)
    }
    this.lifecycle.announceActivity(committed.taskId, sessionId, turnId, event, committed.stored, committed.roster)
    return mapAgentEvent(committed.row)
  }

  private ensureSearchProjection(): Promise<AgentSearchProjection> {
    if (!this.searchProjectionPromise) {
      const pending = import('./searchProjection').then(({ AgentSearchProjection }) => new AgentSearchProjection(this.db))
      this.searchProjectionPromise = pending
      void pending.catch(() => {
        if (this.searchProjectionPromise === pending) this.searchProjectionPromise = undefined
      })
    }
    return this.searchProjectionPromise
  }

  async flushSearch(sessionId?: string): Promise<void> {
    const projection = await this.ensureSearchProjection()
    projection.flush(sessionId)
  }

  private streamTransition(
    tx: Transaction,
    sessionId: string,
    previousSeq: number,
    turnId: string | null,
    event: AgentNormalizedEvent,
  ): { continuation: boolean; closed: boolean } {
    const previous = tx
      .select({ turnId: schema.agentEvents.turnId, eventJson: schema.agentEvents.eventJson })
      .from(schema.agentEvents)
      .where(and(eq(schema.agentEvents.sessionId, sessionId), eq(schema.agentEvents.seq, previousSeq)))
      .get()
    if (!previous) return { continuation: false, closed: false }
    const prior = { turnId: previous.turnId, event: JSON.parse(previous.eventJson) as AgentNormalizedEvent }
    const continuation = continuesStream(prior, { turnId, event })
    return { continuation, closed: isAppendDelta(prior.event) && !continuation }
  }

  private applyEventProjection(
    tx: Parameters<Parameters<PluginDatabase['transaction']>[0]>[0],
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
    timestamp: number,
  ): { turnChanged: boolean; requestChanged: boolean } {
    if (event.type === 'request') {
      const result = tx.insert(schema.agentRequests)
        .values({
          id: randomUUID(),
          sessionId,
          turnId,
          providerRequestId: event.requestId,
          kind: event.kind,
          // A policy plugin's refusal is already the answer, so the row is never pending: nothing
          // notifies, badges, or wakes a delegated parent over it.
          status: event.blocked ? 'resolved' : 'pending',
          ...(event.blocked ? { resolutionJson: JSON.stringify({ blocked: event.blocked }), resolvedAt: timestamp } : {}),
          title: event.title,
          detail: event.detail ?? null,
          // Additive: a row written before `approval` existed reads as the plain consent it was.
          payloadJson: JSON.stringify({
            options: event.options ?? [],
            questions: event.questions ?? [],
            ...(event.approval ? { approval: event.approval } : {}),
          }),
          createdAt: timestamp,
        })
        .onConflictDoNothing()
        .run()
      return { turnChanged: false, requestChanged: result.changes > 0 }
    } else if (event.type === 'request_resolved') {
      const current = tx
        .select({ status: schema.agentRequests.status })
        .from(schema.agentRequests)
        .where(and(eq(schema.agentRequests.sessionId, sessionId), eq(schema.agentRequests.providerRequestId, event.requestId)))
        .get()
      tx.update(schema.agentRequests)
        .set({ status: 'resolved', resolutionJson: JSON.stringify(event.resolution), resolvedAt: timestamp })
        .where(and(
          eq(schema.agentRequests.sessionId, sessionId),
          eq(schema.agentRequests.providerRequestId, event.requestId),
          inArray(schema.agentRequests.status, ['pending', 'resolving']),
        ))
        .run()
      return {
        turnChanged: false,
        requestChanged: current?.status === 'pending' || current?.status === 'resolving',
      }
    } else if (event.type === 'turn_completed' && turnId) {
      const current = tx
        .select({ status: schema.agentTurns.status })
        .from(schema.agentTurns)
        .where(eq(schema.agentTurns.id, turnId))
        .get()
      tx.update(schema.agentTurns)
        .set({
          status: 'completed',
          continuationInputJson: null,
          notBefore: null,
          stopReason: event.stopReason ?? null,
          completedAt: timestamp,
        })
        .where(and(
          eq(schema.agentTurns.id, turnId),
          inArray(schema.agentTurns.status, ['dispatching', 'active']),
        ))
        .run()
      return {
        turnChanged: current?.status === 'dispatching' || current?.status === 'active',
        requestChanged: false,
      }
    } else if (event.type === 'usage' && turnId) {
      tx.update(schema.agentTurns)
        .set({ usageJson: JSON.stringify(event.usage) })
        .where(eq(schema.agentTurns.id, turnId))
        .run()
    } else if (event.type === 'error' && turnId) {
      const current = tx
        .select({ status: schema.agentTurns.status })
        .from(schema.agentTurns)
        .where(eq(schema.agentTurns.id, turnId))
        .get()
      tx.update(schema.agentTurns)
        .set({
          status: event.retryable ? 'interrupted' : 'failed',
          continuationInputJson: null,
          notBefore: null,
          errorJson: JSON.stringify({ code: event.code, message: event.message }),
          completedAt: timestamp,
        })
        .where(and(
          eq(schema.agentTurns.id, turnId),
          inArray(schema.agentTurns.status, ['dispatching', 'active']),
        ))
        .run()
      return {
        turnChanged: current?.status === 'dispatching' || current?.status === 'active',
        requestChanged: false,
      }
    }
    return { turnChanged: false, requestChanged: false }
  }

  async claimRequestResolution(
    sessionId: string,
    providerRequestId: string,
    resolution: unknown,
    idempotencyKey: string,
  ): Promise<{ request: AgentRequest; claimed: boolean }> {
    const result = this.db.transaction((tx) => {
      const request = tx
        .select()
        .from(schema.agentRequests)
        .where(and(
          eq(schema.agentRequests.sessionId, sessionId),
          eq(schema.agentRequests.providerRequestId, providerRequestId),
        ))
        .get()
      if (!request) throw new Error('Agent request not found.')
      if (request.status === 'resolved' || request.status === 'expired') {
        return { request: mapAgentRequest(request), claimed: false }
      }
      if (request.status === 'resolving') {
        if (request.resolutionIdempotencyKey !== idempotencyKey) {
          throw new Error('Agent request resolution is already in progress.')
        }
        return { request: mapAgentRequest(request), claimed: false }
      }
      tx.update(schema.agentRequests)
        .set({
          status: 'resolving',
          resolutionJson: JSON.stringify(resolution),
          resolutionIdempotencyKey: idempotencyKey,
        })
        .where(and(eq(schema.agentRequests.id, request.id), eq(schema.agentRequests.status, 'pending')))
        .run()
      const claimed = tx
        .select()
        .from(schema.agentRequests)
        .where(eq(schema.agentRequests.id, request.id))
        .get()
      if (!claimed) throw new Error('Claimed agent request disappeared.')
      return { request: mapAgentRequest(claimed), claimed: true }
    })
    if (result.claimed) await this.lifecycle.announceRequest(sessionId, providerRequestId)
    return result
  }

  async request(sessionId: string, providerRequestId: string): Promise<AgentRequest | null> {
    const [request] = await this.db
      .select()
      .from(schema.agentRequests)
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        eq(schema.agentRequests.providerRequestId, providerRequestId),
      ))
      .limit(1)
    return request ? mapAgentRequest(request) : null
  }

  async expireClaimedRequest(sessionId: string, providerRequestId: string): Promise<void> {
    const before = await this.request(sessionId, providerRequestId)
    if (before?.status !== 'resolving') return
    await this.db
      .update(schema.agentRequests)
      .set({ status: 'expired', resolvedAt: now() })
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        eq(schema.agentRequests.providerRequestId, providerRequestId),
        eq(schema.agentRequests.status, 'resolving'),
      ))
    await this.lifecycle.announceRequest(sessionId, providerRequestId)
  }

  /** Every open request on the session, or only `providerRequestId` when it's given. */
  async expirePendingRequests(sessionId: string, providerRequestId?: string): Promise<void> {
    const open = and(
      eq(schema.agentRequests.sessionId, sessionId),
      inArray(schema.agentRequests.status, ['pending', 'resolving']),
      providerRequestId ? eq(schema.agentRequests.providerRequestId, providerRequestId) : undefined,
    )
    const requests = await this.db
      .select({ providerRequestId: schema.agentRequests.providerRequestId })
      .from(schema.agentRequests)
      .where(open)
    if (!requests.length) return
    await this.db
      .update(schema.agentRequests)
      .set({ status: 'expired', resolvedAt: now() })
      .where(open)
    for (const request of requests) await this.lifecycle.announceRequest(sessionId, request.providerRequestId)
  }

  async patchSession(
    sessionId: string,
    patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> },
    renameSource: SessionRenameSource = 'user',
  ): Promise<AgentSession> {
    const result = await this.mutateSession(sessionId, patch, { renameSource })
    return result.session
  }

  async renameSession(
    sessionId: string,
    input: { title: string; expectedTitle?: string; source: SessionRenameSource },
  ): Promise<{ session: AgentSession; changed: boolean }> {
    return this.mutateSession(sessionId, { title: input.title }, {
      expectedTitle: input.expectedTitle,
      renameSource: input.source,
    })
  }

  private async mutateSession(
    sessionId: string,
    patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> },
    options: { expectedTitle?: string; renameSource: SessionRenameSource },
  ): Promise<{ session: AgentSession; changed: boolean }> {
    const before = await this.requireSession(sessionId)
    if (options.expectedTitle !== undefined && before.title !== options.expectedTitle) {
      return { session: before, changed: false }
    }
    const title = patch.title !== undefined ? normalizeStoredSessionTitle(patch.title) : undefined
    const renamed = title !== undefined && title !== before.title
    const archiveChanged = patch.archived !== undefined
      && patch.archived !== (before.archivedAt != null)
    const hasOtherWrite = patch.lastReadSeq !== undefined || patch.config !== undefined
    if (!renamed && !archiveChanged && !hasOtherWrite) return { session: before, changed: false }

    const timestamp = now()
    const write = await this.db
      .update(schema.agentSessions)
      .set({
        updatedAt: timestamp,
        ...(renamed ? { title } : {}),
        ...(patch.archived != null
          ? {
              archivedAt: patch.archived ? timestamp : null,
              runtimeState: patch.archived ? 'archived' : 'stopped',
            }
          : {}),
        ...(patch.lastReadSeq != null
          ? {
              lastReadSeq: patch.lastReadSeq,
              attention: 'none',
            }
          : {}),
        ...(patch.config ? { configJson: JSON.stringify(patch.config) } : {}),
      })
      .where(and(
        eq(schema.agentSessions.id, sessionId),
        options.expectedTitle !== undefined
          ? and(
              eq(schema.agentSessions.title, options.expectedTitle),
              title !== undefined ? ne(schema.agentSessions.title, title) : undefined,
            )
          : undefined,
      ))
      .run()
    if (Number(write.changes ?? 0) === 0) {
      return { session: await this.requireSession(sessionId), changed: false }
    }

    const session = await this.requireSession(sessionId)
    const changes: AgentSessionChange[] = [
      ...(renamed ? ['renamed' as const] : []),
      ...(archiveChanged ? [patch.archived ? 'archived' as const : 'restored' as const] : []),
    ]
    this.lifecycle.announceSession(session, changes, options.renameSource)
    return { session, changed: renamed || archiveChanged || hasOtherWrite }
  }

  async setController(sessionId: string, controller: AgentSession['controller']): Promise<AgentSession> {
    await this.db
      .update(schema.agentSessions)
      .set({ controller, updatedAt: now() })
      .where(eq(schema.agentSessions.id, sessionId))
    return this.requireSession(sessionId)
  }

  async setProviderSessionReference(
    sessionId: string,
    providerSessionRef: string | null,
  ): Promise<AgentSession> {
    await this.db
      .update(schema.agentSessions)
      .set({ providerSessionRef, updatedAt: now() })
      .where(eq(schema.agentSessions.id, sessionId))
    return this.requireSession(sessionId)
  }

  async deleteSession(sessionId: string): Promise<RemovedSessionObjects> {
    const session = await this.getSession(sessionId)
    if (!session) return { attachmentIds: [], artifactObjects: [] }
    const removed = this.db.transaction((tx) => {
      const owned = this.deleteOwnedRows(tx, sessionId)
      tx.delete(schema.agentEvents).where(eq(schema.agentEvents.sessionId, sessionId)).run()
      tx.delete(schema.agentSessions).where(eq(schema.agentSessions.id, sessionId)).run()
      return owned
    })
    this.ledgerFold.forget(sessionId)
    this.lifecycle.announceSession(session, ['deleted'])
    return removed
  }

  // What a session owns apart from its row and its events, deleted inside the caller's transaction:
  // its requests, its turns, the attachment references those turns hold, and its artifacts. Returns
  // the attachments and artifact files to collect once the transaction commits. deleteSession and
  // finishHistoryRemoval share it, so the two cannot disagree about what a session owns.
  private deleteOwnedRows(tx: Transaction, sessionId: string): RemovedSessionObjects {
    const turnIds = tx
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, sessionId))
    const attachmentIds = tx
      .selectDistinct({ attachmentId: schema.agentAttachmentRefs.attachmentId })
      .from(schema.agentAttachmentRefs)
      .where(inArray(schema.agentAttachmentRefs.turnId, turnIds))
      .all()
      .map((row) => row.attachmentId)
    const artifactObjects = tx
      .select({ id: schema.agentArtifacts.id, storageKey: schema.agentArtifacts.storageKey })
      .from(schema.agentArtifacts)
      .where(eq(schema.agentArtifacts.sessionId, sessionId))
      .all()
    tx.delete(schema.agentAttachmentRefs).where(inArray(schema.agentAttachmentRefs.turnId, turnIds)).run()
    tx.delete(schema.agentArtifacts).where(eq(schema.agentArtifacts.sessionId, sessionId)).run()
    tx.delete(schema.agentRequests).where(eq(schema.agentRequests.sessionId, sessionId)).run()
    tx.delete(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId)).run()
    return { attachmentIds, artifactObjects }
  }

  // Removing a session's history, for the retention pass (docs/data-layer/backup-and-retention.md § Retention). It works in
  // three steps so the caller can yield between them: find a session, delete its events a batch at a
  // time, then finish it. The session row stays, so an archived or restored task still lists the
  // session, and its transcript says what happened to it.

  /**
   * The oldest session of these tasks whose history is still stored. Never one in `live`, the sessions
   * with a provider process in this node, and never one with a turn being dispatched or running.
   * Synchronous, so a caller can check and write with nothing in between.
   */
  sessionWithHistory(taskIds: readonly string[], live: ReadonlySet<string>): string | null {
    return this.idleSessionOf(taskIds, live, true)
  }

  /** The same, with or without stored history, for deleting a deleted task's sessions outright
   *  (runtime.ts § purgeDeletedTasks). */
  idleSessionOfTasks(taskIds: readonly string[], live: ReadonlySet<string>): string | null {
    return this.idleSessionOf(taskIds, live, false)
  }

  private idleSessionOf(taskIds: readonly string[], live: ReadonlySet<string>, withHistory: boolean): string | null {
    if (!taskIds.length) return null
    const running = this.db
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, schema.agentSessions.id),
        inArray(schema.agentTurns.status, ['dispatching', 'active']),
      ))
    return this.db
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .where(and(
        inArray(schema.agentSessions.taskId, [...taskIds]),
        withHistory ? isNull(schema.agentSessions.historyRemovedAt) : undefined,
        notExists(running),
        live.size ? notInArray(schema.agentSessions.id, [...live]) : undefined,
      ))
      .orderBy(asc(schema.agentSessions.createdAt))
      .limit(1)
      .get()?.id ?? null
  }

  /** Deletes up to `limit` of a session's oldest events in one transaction. Returns how many went. The
   *  search index loses their rows through the delete trigger. */
  deleteOldestEvents(sessionId: string, limit: number): number {
    return this.db.transaction((tx) => {
      const ids = tx
        .select({ id: schema.agentEvents.id })
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.sessionId, sessionId))
        .orderBy(asc(schema.agentEvents.seq))
        .limit(limit)
        .all()
        .map((row) => row.id)
      if (ids.length) tx.delete(schema.agentEvents).where(inArray(schema.agentEvents.id, ids)).run()
      return ids.length
    })
  }

  /**
   * The last step, in one transaction: the events still left, everything deleteOwnedRows removes, then
   * one diagnostic event with `message`, so the transcript explains itself. The row is marked, and its
   * roster, queue count and unread state are cleared, because each was read off the rows just deleted.
   * Returns null when the session is gone or already marked, which makes a second run a no-op.
   */
  async finishHistoryRemoval(sessionId: string, message: string): Promise<(RemovedSessionObjects & {
    session: AgentSession
    event: AgentEventRecord
  }) | null> {
    const timestamp = now()
    const event: AgentNormalizedEvent = { type: 'diagnostic', level: 'info', message }
    const committed = this.db.transaction((tx) => {
      const current = tx
        .select({ lastEventSeq: schema.agentSessions.lastEventSeq, historyRemovedAt: schema.agentSessions.historyRemovedAt })
        .from(schema.agentSessions)
        .where(eq(schema.agentSessions.id, sessionId))
        .get()
      if (!current || current.historyRemovedAt != null) return null
      const owned = this.deleteOwnedRows(tx, sessionId)
      tx.delete(schema.agentEvents).where(eq(schema.agentEvents.sessionId, sessionId)).run()
      // The next sequence, never a reused one: a client that held this session resumes after its mark.
      const seq = current.lastEventSeq + 1
      const row: typeof schema.agentEvents.$inferSelect = {
        id: randomUUID(),
        sessionId,
        turnId: null,
        seq,
        schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
        eventJson: JSON.stringify(event),
        searchText: agentEventSearchText(event),
        createdAt: timestamp,
      }
      tx.insert(schema.agentEvents).values(row).run()
      // `updatedAt` is left alone, so the task's sessions keep their order.
      tx.update(schema.agentSessions)
        .set({
          lastEventSeq: seq,
          lastReadSeq: seq,
          attention: 'none',
          subagentsJson: null,
          queuedTurns: 0,
          historyRemovedAt: timestamp,
        })
        .where(eq(schema.agentSessions.id, sessionId))
        .run()
      return { ...owned, row }
    })
    if (!committed) return null
    this.ledgerFold.forget(sessionId)
    return {
      attachmentIds: committed.attachmentIds,
      artifactObjects: committed.artifactObjects,
      session: await this.requireSession(sessionId),
      event: mapAgentEvent(committed.row),
    }
  }

  async searchSessions(query: string, filter: SessionSearchFilter = {}): Promise<AgentSession[]> {
    const [taskIds, projection, { searchSessions }] = await Promise.all([
      this.workspaceTaskIds(filter.workspaceId), this.ensureSearchProjection(), import('./sessionSearch'),
    ])
    return this.db.transaction((tx) => {
      projection.catchUp(tx)
      return searchSessions(tx, query, filter, taskIds)
    })
  }

  async searchTaskSessions(query: string, taskIds: readonly string[], limit: number): Promise<SearchHit[]> {
    const [projection, { searchTaskSessions }] = await Promise.all([this.ensureSearchProjection(), import('./sessionSearch')])
    return this.db.transaction((tx) => {
      projection.catchUp(tx)
      return searchTaskSessions(tx, query, taskIds, limit)
    })
  }

  async searchSessionHistory(sessionId: string, query: string, role?: HistoryRole, limit = 8): Promise<HistoryHit[]> {
    const [projection, history] = await Promise.all([this.ensureSearchProjection(), import('./sessionHistory')])
    return this.db.transaction((tx) => {
      projection.catchUp(tx, sessionId)
      return history.searchSessionHistory(tx, sessionId, query, role, limit)
    })
  }

  async readSessionHistory(sessionId: string, seq: number, offset = 0): Promise<HistoryPage | null> {
    const [projection, history] = await Promise.all([this.ensureSearchProjection(), import('./sessionHistory')])
    return this.db.transaction((tx) => {
      projection.catchUp(tx, sessionId)
      return history.readSessionHistory(tx, sessionId, seq, offset)
    })
  }

  async activeTurn(sessionId: string): Promise<AgentTurn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), inArray(schema.agentTurns.status, ['dispatching', 'active'])))
      .limit(1)
    return row ? mapAgentTurn(row) : null
  }

  async pendingRequests(sessionId: string): Promise<AgentRequest[]> {
    const rows = await this.db
      .select()
      .from(schema.agentRequests)
      .where(and(eq(schema.agentRequests.sessionId, sessionId), eq(schema.agentRequests.status, 'pending')))
      .orderBy(asc(schema.agentRequests.createdAt))
    return rows.map(mapAgentRequest)
  }

  lifecycleTurns(filter: { taskId: string; sessionId?: string }) {
    return this.lifecycle.turns(filter)
  }

  lifecycleRequests(filter: { taskId: string; sessionId?: string }) {
    return this.lifecycle.requests(filter)
  }

  lifecycleSessions(taskId: string) {
    return this.lifecycle.sessions(taskId)
  }

  lifecycleReviewInput(ref: { taskId: string; sessionId: string; turnId: string }) {
    return this.lifecycle.reviewInput(ref)
  }

  lifecycleActivity(ref: { taskId: string; sessionId: string }) {
    return this.lifecycle.activity(ref)
  }

  /**
   * Queues an interactive turn decided from the session's latest turn and that turn's events, in one
   * SQLite transaction, so no other turn lands between the decision and the write. `decide` gets `null`
   * when the session has no turn yet, and throws to refuse. It returns the config to save, the new
   * turn's input, and the policy values the turn asks for. A turn already queued under
   * `idempotencyKey` comes back as it is, with `inserted` false. The Codex plan handoff is the caller
   * (../drivers/codexPlanHandoff.ts).
   */
  async enqueueAfterLatestTurn(
    sessionId: string,
    idempotencyKey: string,
    decide: (session: AgentSession, latest: { turn: AgentTurn; events: AgentEventRecord[] } | null) => {
      config: Record<string, unknown>
      input: AgentTurn['input']
      policy: Record<string, unknown>
    },
  ): Promise<{ turn: AgentTurn; inserted: boolean }> {
    const result = this.db.transaction((tx) => {
      const sessionRow = tx.select().from(schema.agentSessions)
        .where(eq(schema.agentSessions.id, sessionId)).get()
      if (!sessionRow) throw new Error(`Managed agent session not found: ${sessionId}`)
      const existing = tx.select().from(schema.agentTurns)
        .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.idempotencyKey, idempotencyKey))).get()
      if (existing) return { turn: mapAgentTurn(existing), inserted: false }
      const lastRow = tx.select().from(schema.agentTurns)
        .where(eq(schema.agentTurns.sessionId, sessionId))
        .orderBy(desc(schema.agentTurns.ordinal)).limit(1).get()
      const latest = lastRow ? {
        turn: mapAgentTurn(lastRow),
        events: tx.select().from(schema.agentEvents)
          .where(and(eq(schema.agentEvents.sessionId, sessionId), eq(schema.agentEvents.turnId, lastRow.id)))
          .orderBy(asc(schema.agentEvents.seq)).all().map(mapAgentEvent),
      } : null
      const session = mapAgentSession(sessionRow)
      const { config, input, policy } = decide(session, latest)
      const timestamp = now()
      const turnId = randomUUID()
      tx.update(schema.agentSessions).set({
        configJson: JSON.stringify(config),
        queuedTurns: sessionRow.queuedTurns + 1,
        updatedAt: timestamp,
      }).where(eq(schema.agentSessions.id, sessionId)).run()
      tx.insert(schema.agentTurns).values({
        id: turnId,
        sessionId,
        ordinal: (lastRow?.ordinal ?? -1) + 1,
        source: 'interactive',
        status: 'queued',
        inputJson: JSON.stringify(input),
        effectivePolicyJson: JSON.stringify(effectiveTurnPolicy(
          { ...session, config }, policy, resolveAttendance(session, 'interactive'), timestamp,
        )),
        idempotencyKey,
        createdAt: timestamp,
      }).run()
      const turnRow = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()!
      return { turn: mapAgentTurn(turnRow), inserted: true }
    })
    if (result.inserted) await this.lifecycle.announceTurn(result.turn.id)
    return { ...result, turn: await this.restoreTurnAttendance(result.turn.id) }
  }

  async createSession(input: CreateAgentSessionInput, provider: AgentProviderDescriptor, posture?: WorkflowPosture): Promise<AgentSession> {
    const timestamp = now()
    const id = randomUUID()
    await this.db.insert(schema.agentSessions).values({
      id,
      taskId: input.taskId,
      providerId: input.providerId,
      profileId: input.profileId,
      kind: input.kind,
      originJson: input.origin ? JSON.stringify(input.origin) : null,
      driverKind: provider.driverKind,
      driverVersion: provider.driverVersion,
      providerSessionRef: input.resumeProviderSessionRef ?? null,
      controller: 'acorn',
      runtimeState: provider.driverKind === 'terminal' ? 'stopped' : 'creating',
      attention: 'none',
      statusAuthority: provider.statusAuthority,
      title: input.title ?? DEFAULT_SESSION_TITLE,
      configJson: JSON.stringify({ ...input.config, initialAttendance: resolveAttendance(input, 'interactive', posture) }),
      parentSessionId: input.parentSessionId ?? null,
      parentTurnId: input.parentTurnId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const session = await this.requireSession(id)
    this.lifecycle.announceSession(session, ['created'])
    return session
  }

  /** Recover a delegated session when the process exited after its row was written but before the
   * spawn ledger or operation record was updated. The spawn id is server-authored configuration;
   * this scan is startup-only and deliberately does not become an authorization lookup. */
  async delegatedSessionForSpawn(spawnId: string): Promise<AgentSession | null> {
    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.kind, 'delegated'))
    for (const row of rows) {
      const session = mapAgentSession(row)
      if (session.config.delegationSpawnId === spawnId) return session
    }
    return null
  }

  async turnForIdempotency(sessionId: string, idempotencyKey: string): Promise<AgentTurn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        eq(schema.agentTurns.idempotencyKey, idempotencyKey),
      ))
      .limit(1)
    return row ? mapAgentTurn(row) : null
  }

  async operationResult<T>(idempotencyKey: string, command: string): Promise<T | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentOperations)
      .where(and(
        eq(schema.agentOperations.idempotencyKey, idempotencyKey),
        eq(schema.agentOperations.command, command),
      ))
      .limit(1)
    if (!row) return null
    try {
      return JSON.parse(row.resultJson) as T
    } catch {
      return null
    }
  }

  async saveOperation(
    idempotencyKey: string,
    command: string,
    result: unknown,
    resourceId?: string,
  ): Promise<void> {
    await this.db
      .insert(schema.agentOperations)
      .values({
        idempotencyKey,
        command,
        resourceId: resourceId ?? null,
        resultJson: JSON.stringify(result),
        createdAt: now(),
      })
      .onConflictDoNothing()
  }

  async listSessions(filter: SessionListFilter = {}): Promise<AgentSessionList> {
    const cursor = filter.cursor == null ? null : sessionCursor(filter.cursor, filter.cursorFormat)
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100)
    // A workspace-scoped read, like searchSessions(). Resolved to task
    // ids through core rather than joined, because `tasks` lives in core's database and this table
    // lives in the plugin's. An empty result narrows to nothing, not to unfiltered.
    // See docs/managed-agents/sessions.md § Session model.
    const taskIds = await this.workspaceTaskIds(filter.workspaceId)
    if (taskIds?.length === 0) return { sessions: [], delegations: [], nextCursor: null }
    // A session outlives its task's worktree but not its task. A caller already pinned to a task id is
    // exempt (docs/managed-agents/client-surfaces.md § Retired and archived sessions).
    //
    // One extra core read per list call, fine while `active()` is a small table scan. If it stops being
    // one, core grows an `activeIds()` and this asks for that instead.
    const activeIds = filter.taskId ? null : (await this.core.tasks.active()).map((task) => task.id)
    const liveTask = activeIds && (activeIds.length ? inArray(schema.agentSessions.taskId, activeIds) : sql`0`)
    const retiredTask = activeIds && (activeIds.length ? notInArray(schema.agentSessions.taskId, activeIds) : sql`1`)
    const conditions = [
      filter.taskId ? eq(schema.agentSessions.taskId, filter.taskId) : undefined,
      taskIds ? inArray(schema.agentSessions.taskId, taskIds) : undefined,
      filter.archived
        ? or(isNotNull(schema.agentSessions.archivedAt), retiredTask || undefined)
        : and(isNull(schema.agentSessions.archivedAt), liveTask || undefined),
      filter.attention ? sql`${schema.agentSessions.attention} NOT IN ('none', 'unread')` : undefined,
      cursor == null ? undefined : typeof cursor === 'number'
        ? lt(schema.agentSessions.updatedAt, cursor)
        : or(lt(schema.agentSessions.updatedAt, cursor.updatedAt), and(eq(schema.agentSessions.updatedAt, cursor.updatedAt), lt(schema.agentSessions.id, cursor.id))),
      filter.search ? like(schema.agentSessions.title, `%${filter.search.replace(/[%_]/g, '\\$&')}%`) : undefined,
    ].filter((item): item is Exclude<typeof item, undefined> => item != null)

    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.agentSessions.updatedAt), desc(schema.agentSessions.id))
      .limit(limit + 1)
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).map(mapAgentSession)
    const last = page.at(-1)
    return { sessions: page, delegations: [], nextCursor: hasMore && last
      ? filter.cursorFormat === 'tuple-v1' ? `v1:${last.updatedAt}:${last.id}` : String(last.updatedAt)
      : null }
  }

  async snapshot(sessionId: string, afterSeq = 0, eventLimit = 500): Promise<AgentSessionSnapshot> {
    await this.requireSession(sessionId)
    return this.readSnapshot(sessionId, afterSeq, Math.min(Math.max(eventLimit, 1), 2_000), false)
  }

  async clientSnapshot(sessionId: string, afterSeq = 0, eventLimit = 500): Promise<AgentSessionSnapshot> {
    return this.readSnapshot(sessionId, afterSeq, Math.min(Math.max(eventLimit, 1), 2_000), true)
  }

  async waitFacts(sessionId: string, afterSeq: number, until: AgentWaitCondition): Promise<AgentWaitFacts> {
    return this.db.transaction((tx) => readWaitFacts(tx, sessionId, afterSeq, until))
  }

  async waitSnapshot(sessionId: string, afterSeq: number, until: AgentWaitCondition): Promise<AgentSessionSnapshot> {
    await this.requireSession(sessionId)
    return this.readSnapshot(sessionId, afterSeq, 500, false, until)
  }

  async executionSnapshot(sessionId: string, turnIds: readonly string[]): Promise<AgentSessionSnapshot> {
    const projection = await this.ensureSearchProjection()
    return this.db.transaction((tx) => {
      projection.catchUp(tx, sessionId)
      return readExecutionCapture(tx, sessionId, turnIds)
    })
  }

  async exportSnapshot(sessionId: string): Promise<AgentSessionSnapshot> {
    return this.readSnapshot(sessionId, 0, undefined, false)
  }

  private async readSnapshot(sessionId: string, afterSeq: number, limit: number | undefined, client: boolean, until?: AgentWaitCondition): Promise<AgentSessionSnapshot> {
    const projection = client ? null : await this.ensureSearchProjection()
    const commands = client ? await import('./commandLifecycle') : null
    return this.db.transaction((tx) => {
      projection?.catchUp(tx, sessionId)
      const session = tx.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, sessionId)).get()
      if (!session) throw new Error(`Managed agent session not found: ${sessionId}`)
      const events = tx.select(eventReadColumns(client)).from(schema.agentEvents)
        .where(and(eq(schema.agentEvents.sessionId, sessionId), gt(schema.agentEvents.seq, afterSeq)))
        .orderBy(asc(schema.agentEvents.seq))
      const rows = limit === undefined ? events.all() : events.limit(limit).all()
      const mappedSession = mapAgentSession(session)
      const turns = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId))
        .orderBy(asc(schema.agentTurns.ordinal)).all().map(mapAgentTurn)
      return {
        session: mappedSession,
        turns,
        events: client ? commands!.projectCommandEvents(rows.map((row) => clientEventRecord(mapAgentEvent(row))), mappedSession, turns)
          : rows.map(mapAgentEvent),
        requests: tx.select().from(schema.agentRequests).where(eq(schema.agentRequests.sessionId, sessionId))
          .orderBy(asc(schema.agentRequests.createdAt)).all().map(mapAgentRequest),
        ...(until ? { wait: {
          ...readWaitFacts(tx, sessionId, afterSeq, until, mappedSession),
          eventsThroughSeq: session.lastEventSeq,
          eventsComplete: !tx.select({ seq: schema.agentEvents.seq }).from(schema.agentEvents)
            .where(and(eq(schema.agentEvents.sessionId, sessionId), gt(schema.agentEvents.seq, rows.at(-1)?.seq ?? afterSeq)))
            .limit(1).get(),
        } } : {}),
      }
    })
  }

  async eventsForTurn(turnId: string, limit = 2_000): Promise<AgentEventRecord[]> {
    const projection = await this.ensureSearchProjection()
    return this.db.transaction((tx) => {
      const turn = tx.select({ sessionId: schema.agentTurns.sessionId }).from(schema.agentTurns)
        .where(eq(schema.agentTurns.id, turnId)).get()
      if (turn) projection.catchUp(tx, turn.sessionId)
      else projection.catchUp(tx)
      return tx.select().from(schema.agentEvents).where(eq(schema.agentEvents.turnId, turnId))
        .orderBy(asc(schema.agentEvents.seq)).limit(Math.min(Math.max(limit, 1), 10_000)).all().map(mapAgentEvent)
    })
  }

  async eventPage(sessionId: string, afterSeq = 0, limit = 500): Promise<AgentEventPage> {
    return this.readEventPage(sessionId, afterSeq, limit, false)
  }

  async clientEventPage(sessionId: string, afterSeq = 0, limit = 500): Promise<AgentEventPage> {
    return this.readEventPage(sessionId, afterSeq, limit, true)
  }

  private async readEventPage(sessionId: string, afterSeq: number, limit: number, client: boolean): Promise<AgentEventPage> {
    const projection = client ? null : await this.ensureSearchProjection()
    const commands = client ? await import('./commandLifecycle') : null
    return this.db.transaction((tx) => {
      projection?.catchUp(tx, sessionId)
      const bounded = Math.min(Math.max(limit, 1), 2_000)
      const rows = tx.select(eventReadColumns(client)).from(schema.agentEvents)
        .where(and(eq(schema.agentEvents.sessionId, sessionId), gt(schema.agentEvents.seq, afterSeq)))
        .orderBy(asc(schema.agentEvents.seq)).limit(bounded + 1).all()
      const page = rows.slice(0, bounded).map((row) => client ? clientEventRecord(mapAgentEvent(row)) : mapAgentEvent(row))
      const session = client ? tx.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, sessionId)).get() : null
      const turns = session ? tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId)).all().map(mapAgentTurn) : []
      return { events: session ? commands!.projectCommandEvents(page, mapAgentSession(session), turns) : page,
        nextCursor: rows.length > bounded ? page.at(-1)?.seq ?? null : null }
    })
  }

  async unfinishedCommands(sessionId?: string): Promise<AgentEventRecord[]> {
    const { unfinishedCommands } = await import('./commandLifecycle')
    return this.db.transaction((tx) => unfinishedCommands(tx, sessionId))
  }

  /** Recompute a session's queued-turn count and store it on the row. Called after every change that
   *  can move a turn into or out of the queue. A recount rather than a running tally, because a count
   *  that drifts is a mark that lies, and the query is one indexed row count. */
  private async recountQueuedTurns(sessionId: string): Promise<void> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.status, 'queued')))
    await this.db
      .update(schema.agentSessions)
      .set({ queuedTurns: Number(row?.count ?? 0) })
      .where(eq(schema.agentSessions.id, sessionId))
  }

  async enqueueTurn(sessionId: string, input: EnqueueAgentTurnInput, context: TurnAttendanceContext = {}): Promise<EnqueueTurnOutcome> {
    const [existing] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.idempotencyKey, input.idempotencyKey)))
      .limit(1)
    if (existing) {
      return {
        turn: await this.restoreTurnAttendance(existing.id),
        inserted: false,
        firstTurnFallback: null,
        sessionAfterRename: null,
      }
    }

    const session = await this.requireSession(sessionId)
    const posture = context.posture ?? (session.kind === 'workflow'
      ? sessionAttendance(session) === 'autonomous' ? 'autonomous' : 'gated'
      : undefined)
    const resolved = resolveAttendance(session, input.source, posture)
    if (session.config.initialAttendance !== undefined && sessionAttendance(session) !== resolved) {
      throw new Error('Turn attendance does not match the session bootstrap policy.')
    }
    const originId = context.originTurnId
    const origin = typeof originId === 'string' ? await this.turn(originId) : null
    if (originId !== undefined && (!origin || origin.sessionId !== sessionId)) {
      throw new Error('Turn continuation origin is unavailable in this session.')
    }
    const attendance = origin
      ? persistedAttendance(origin.effectivePolicy, { session, source: origin.source })
      : resolved
    if (attendance !== resolved) throw new Error('The continuation origin has a different attendance policy.')

    const attachmentParts = input.input.flatMap((part, position) =>
      part.type === 'attachment' || part.type === 'image'
        ? [{ id: part.attachmentId, position }]
        : [])
    const uniqueAttachmentIds = [...new Set(attachmentParts.map((part) => part.id))]
    let attachmentRows: Array<typeof schema.agentAttachments.$inferSelect> = []
    if (uniqueAttachmentIds.length > 8) throw new Error('A turn can include at most eight attachments.')
    if (uniqueAttachmentIds.length) {
      const [session] = await this.db
        .select({ taskId: schema.agentSessions.taskId })
        .from(schema.agentSessions)
        .where(eq(schema.agentSessions.id, sessionId))
        .limit(1)
      if (!session) throw new Error(`Managed agent session not found: ${sessionId}`)
      attachmentRows = await this.db
        .select()
        .from(schema.agentAttachments)
        .where(and(
          inArray(schema.agentAttachments.id, uniqueAttachmentIds),
          eq(schema.agentAttachments.taskId, session.taskId),
          isNull(schema.agentAttachments.deletedAt),
        ))
      if (attachmentRows.length !== uniqueAttachmentIds.length) {
        throw new Error('One or more attachments are missing or belong to another task.')
      }
      const aggregateBytes = attachmentRows.reduce((total, attachment) => total + attachment.byteSize, 0)
      if (aggregateBytes > 25 * 1024 * 1024) throw new Error('Turn attachments are limited to 25 MiB in total.')
    }

    const [maxRow] = await this.db
      .select({ ordinal: sql<number>`coalesce(max(${schema.agentTurns.ordinal}), -1)` })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, sessionId))
    const timestamp = now()
    const id = randomUUID()
    await this.db.insert(schema.agentTurns).values({
      id,
      sessionId,
      ordinal: Number(maxRow?.ordinal ?? -1) + 1,
      source: input.source,
      status: 'queued',
      inputJson: JSON.stringify(input.input),
      effectivePolicyJson: JSON.stringify(effectiveTurnPolicy(session, input.effectivePolicy, attendance, timestamp)),
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    })
    if (uniqueAttachmentIds.length) {
      await this.db.insert(schema.agentAttachmentRefs).values(uniqueAttachmentIds.map((attachmentId) => ({
        attachmentId,
        turnId: id,
        position: attachmentParts.find((part) => part.id === attachmentId)?.position ?? 0,
      })))
    }
    let firstTurnFallback: string | null = null
    let sessionAfterRename: AgentSession | null = null
    if (Number(maxRow?.ordinal ?? -1) < 0) {
      const firstAttachmentId = attachmentParts.toSorted((left, right) => left.position - right.position)[0]?.id
      const title = deterministicSessionTitle(
        input.input,
        attachmentRows.find((attachment) => attachment.id === firstAttachmentId)?.filename,
      )
      if (title) {
        const renamed = await this.renameSession(sessionId, {
          title,
          expectedTitle: DEFAULT_SESSION_TITLE,
          source: 'generated',
        })
        if (renamed.changed) {
          firstTurnFallback = renamed.session.title
          sessionAfterRename = renamed.session
        }
      }
    }
    await this.recountQueuedTurns(sessionId)
    const [row] = await this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, id)).limit(1)
    if (!row) throw new Error('Queued turn was not persisted.')
    const turn = mapAgentTurn(row)
    await this.lifecycle.announceTurn(turn.id)
    return { turn, inserted: true, firstTurnFallback, sessionAfterRename }
  }

  /** Backfill pre-policy turns before dispatch or an idempotent acceptance returns them. */
  async restoreTurnAttendance(turnId: string): Promise<AgentTurn> {
    const turn = await this.turn(turnId)
    if (!turn) throw new Error('Agent turn not found.')
    const session = await this.requireSession(turn.sessionId)
    const attendance = persistedAttendance(turn.effectivePolicy, { session, source: turn.source })
    if (turn.effectivePolicy.attendance !== undefined) return turn
    const row = this.db.transaction((tx) => {
      const current = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()
      if (!current) throw new Error('Agent turn not found.')
      const policy = JSON.parse(current.effectivePolicyJson) as Record<string, unknown>
      const value = policy.attendance === undefined ? attendance : persistedAttendance(policy)
      const effectivePolicyJson = JSON.stringify({ ...policy, attendance: value })
      tx.update(schema.agentTurns).set({ effectivePolicyJson }).where(eq(schema.agentTurns.id, turnId)).run()
      return { ...current, effectivePolicyJson }
    })
    return mapAgentTurn(row)
  }

  /**
   * One turn row by id, or `null` if it has gone. This is what a `turn_completed` frame carries, so a
   * client learns the turn's status, stop reason and usage without refetching the session
   * (../../client/sessions/managedStore.ts).
   */
  async turn(turnId: string): Promise<AgentTurn | null> {
    const [row] = await this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).limit(1)
    return row ? mapAgentTurn(row) : null
  }

  /** Save host check facts once. Reconciliation reuses them even if the worktree later changes. */
  async saveCheckResultsOnce(turnId: string, results: CheckResults): Promise<AgentTurn | null> {
    const row = this.db.transaction((tx) => {
      const current = tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()
      if (!current) return null
      const policy = JSON.parse(current.effectivePolicyJson) as Record<string, unknown>
      if (policy.checkResults !== undefined) return current
      const next = JSON.stringify({ ...policy, checkResults: results })
      tx.update(schema.agentTurns).set({ effectivePolicyJson: next }).where(eq(schema.agentTurns.id, turnId)).run()
      return { ...current, effectivePolicyJson: next }
    })
    return row ? mapAgentTurn(row) : null
  }

  /** The durable prompt a manual title regeneration describes. This stays a narrow read: title
   *  regeneration does not need the session's event ledger, requests, or later turns. */
  async firstTurn(sessionId: string): Promise<AgentTurn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, sessionId))
      .orderBy(asc(schema.agentTurns.ordinal))
      .limit(1)
    return row ? mapAgentTurn(row) : null
  }

  async nextQueuedTurn(sessionId: string): Promise<AgentTurn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.status, 'queued')))
      .orderBy(asc(schema.agentTurns.ordinal))
      .limit(1)
    return row ? mapAgentTurn(row) : null
  }

  async patchQueuedTurn(
    sessionId: string,
    turnId: string,
    patch: { input?: AgentTurn['input']; ordinal?: number },
  ): Promise<AgentTurn> {
    const [current] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.sessionId, sessionId)))
      .limit(1)
    if (!current) throw new Error('Queued agent turn not found.')
    if (current.status !== 'queued') throw new Error('Only queued turns can be edited or reordered.')
    if (current.continuationInputJson && patch.input) {
      throw new Error('An automatic continuation can be cancelled, but its prompt cannot be edited.')
    }

    let attachmentParts: Array<{ id: string; position: number }> | null = null
    if (patch.input) {
      attachmentParts = patch.input.flatMap((part, position) =>
        part.type === 'attachment' || part.type === 'image'
          ? [{ id: part.attachmentId, position }]
          : [])
      const ids = [...new Set(attachmentParts.map((part) => part.id))]
      if (ids.length > 8) throw new Error('A turn can include at most eight attachments.')
      if (ids.length) {
        const [session] = await this.db
          .select({ taskId: schema.agentSessions.taskId })
          .from(schema.agentSessions)
          .where(eq(schema.agentSessions.id, sessionId))
          .limit(1)
        const attachments = session
          ? await this.db
              .select()
              .from(schema.agentAttachments)
              .where(and(
                inArray(schema.agentAttachments.id, ids),
                eq(schema.agentAttachments.taskId, session.taskId),
                isNull(schema.agentAttachments.deletedAt),
              ))
          : []
        if (attachments.length !== ids.length) {
          throw new Error('One or more attachments are missing or belong to another task.')
        }
        if (attachments.reduce((total, attachment) => total + attachment.byteSize, 0) > 25 * 1024 * 1024) {
          throw new Error('Turn attachments are limited to 25 MiB in total.')
        }
      }
    }

    this.db.transaction((tx) => {
      if (patch.input && attachmentParts) {
        tx.delete(schema.agentAttachmentRefs).where(eq(schema.agentAttachmentRefs.turnId, turnId)).run()
        const unique = [...new Set(attachmentParts.map((part) => part.id))]
        if (unique.length) {
          tx.insert(schema.agentAttachmentRefs).values(unique.map((attachmentId) => ({
            attachmentId,
            turnId,
            position: attachmentParts!.find((part) => part.id === attachmentId)?.position ?? 0,
          }))).run()
        }
        tx.update(schema.agentTurns)
          .set({ inputJson: JSON.stringify(patch.input) })
          .where(eq(schema.agentTurns.id, turnId))
          .run()
      }
      if (patch.ordinal != null) {
        const queued = tx
          .select({ id: schema.agentTurns.id, ordinal: schema.agentTurns.ordinal })
          .from(schema.agentTurns)
          .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.status, 'queued')))
          .orderBy(asc(schema.agentTurns.ordinal))
          .all()
        const target = queued.find((row) => row.id === turnId)
        if (target) {
          const ordered = queued.filter((row) => row.id !== turnId)
          ordered.splice(Math.min(patch.ordinal, ordered.length), 0, target)
          const slots = queued.map((row) => row.ordinal).sort((a, b) => a - b)
          ordered.forEach((row, index) => {
            tx.update(schema.agentTurns)
              .set({ ordinal: -1_000_000 - index })
              .where(eq(schema.agentTurns.id, row.id))
              .run()
          })
          ordered.forEach((row, index) => {
            tx.update(schema.agentTurns)
              .set({ ordinal: slots[index]! })
              .where(eq(schema.agentTurns.id, row.id))
              .run()
          })
        }
      }
    })
    const [updated] = await this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).limit(1)
    if (!updated) throw new Error('Queued agent turn disappeared while updating.')
    return mapAgentTurn(updated)
  }

  async dispatchTurn(turnId: string): Promise<void> {
    const before = await this.turn(turnId)
    if (before?.status !== 'queued') return
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'dispatching',
        notBefore: null,
        attempt: sql`${schema.agentTurns.attempt} + 1`,
        startedAt: now(),
        completedAt: null,
        errorJson: null,
      })
      .where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.status, 'queued')))
    await this.recountQueuedTurns(before.sessionId)
    const after = await this.turn(turnId)
    if (after?.status === 'dispatching') await this.lifecycle.announceTurn(turnId)
  }

  async startTurn(turnId: string): Promise<void> {
    const before = await this.turn(turnId)
    if (!before || (before.status !== 'queued' && before.status !== 'dispatching')) return
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'active',
        ...(before.status === 'queued'
          ? {
              attempt: sql`${schema.agentTurns.attempt} + 1`,
              startedAt: now(),
              completedAt: null,
              errorJson: null,
            }
          : {}),
      })
      .where(and(
        eq(schema.agentTurns.id, turnId),
        eq(schema.agentTurns.status, before.status),
      ))
    if (before.status === 'queued') await this.recountQueuedTurns(before.sessionId)
    const after = await this.turn(turnId)
    if (after?.status === 'active') await this.lifecycle.announceTurn(turnId)
  }

  async requeueTransientTurn(turnId: string, message: string): Promise<void> {
    const before = await this.turn(turnId)
    if (before?.status !== 'active') return
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'queued',
        providerTurnRef: null,
        startedAt: null,
        completedAt: null,
        errorJson: JSON.stringify({ code: 'safe_transient_retry', message }),
      })
      .where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.status, 'active')))
    await this.recountQueuedTurns(before.sessionId)
    const after = await this.turn(turnId)
    if (after?.status === 'queued') await this.lifecycle.announceTurn(turnId)
  }

  /** Pause the same logical turn until a provider usage window resets. Keeping the turn id and its
   * original input means workflow and delegation waiters keep waiting on the operation they started. */
  async deferTurnForUsageLimit(
    turnId: string,
    notBefore: number,
    continuationInput: AgentTurn['input'],
  ): Promise<AgentTurn | null> {
    const before = await this.turn(turnId)
    if (!before || !['dispatching', 'active'].includes(before.status)) return null
    this.db.transaction((tx) => {
      tx
        .update(schema.agentTurns)
        .set({
          status: 'queued',
          continuationInputJson: JSON.stringify(continuationInput),
          notBefore,
          providerTurnRef: null,
          stopReason: 'usage_limit',
          startedAt: null,
          completedAt: null,
          errorJson: null,
        })
        .where(and(
          eq(schema.agentTurns.id, turnId),
          inArray(schema.agentTurns.status, ['dispatching', 'active']),
        ))
        .run()
      const queued = tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.agentTurns)
        .where(and(eq(schema.agentTurns.sessionId, before.sessionId), eq(schema.agentTurns.status, 'queued')))
        .get()
      tx
        .update(schema.agentSessions)
        .set({
          queuedTurns: Number(queued?.count ?? 0),
          runtimeState: 'ready',
          attention: 'none',
          updatedAt: now(),
        })
        .where(eq(schema.agentSessions.id, before.sessionId))
        .run()
    })
    const after = await this.turn(turnId)
    if (after?.status === 'queued') await this.lifecycle.announceTurn(turnId)
    return after?.status === 'queued' ? after : null
  }

  async setTurnProviderRef(turnId: string, providerTurnRef: string): Promise<void> {
    await this.db
      .update(schema.agentTurns)
      .set({ providerTurnRef })
      .where(eq(schema.agentTurns.id, turnId))
  }

  async cancelTurn(turnId: string): Promise<void> {
    const before = await this.turn(turnId)
    if (!before || !['queued', 'dispatching', 'active'].includes(before.status)) return
    await this.db
      .update(schema.agentTurns)
      .set({ status: 'cancelled', continuationInputJson: null, notBefore: null, completedAt: now() })
      .where(and(eq(schema.agentTurns.id, turnId), inArray(schema.agentTurns.status, ['queued', 'dispatching', 'active'])))
    if (before.status === 'queued') await this.recountQueuedTurns(before.sessionId)
    const after = await this.turn(turnId)
    if (after?.status === 'cancelled') await this.lifecycle.announceTurn(turnId)
  }

  async interruptActiveTurn(sessionId: string, message: string): Promise<void> {
    const before = await this.db
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        inArray(schema.agentTurns.status, ['dispatching', 'active']),
      ))
    if (!before.length) return
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'interrupted',
        continuationInputJson: null,
        notBefore: null,
        errorJson: JSON.stringify({ code: 'provider_disconnected', message }),
        completedAt: now(),
      })
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        inArray(schema.agentTurns.status, ['dispatching', 'active']),
      ))
    for (const turn of before) await this.lifecycle.announceTurn(turn.id)
  }

  async queuedHeads(): Promise<Array<{ session: AgentSession; turn: AgentTurn }>> {
    const heads = this.db.select({
      sessionId: schema.agentTurns.sessionId,
      ordinal: sql<number>`min(${schema.agentTurns.ordinal})`.as('head_ordinal'),
    }).from(schema.agentTurns).where(eq(schema.agentTurns.status, 'queued'))
      .groupBy(schema.agentTurns.sessionId).as('heads')
    const rows = await this.db.select({ session: schema.agentSessions, turn: schema.agentTurns })
      .from(heads)
      .innerJoin(schema.agentTurns, and(eq(schema.agentTurns.sessionId, heads.sessionId), eq(schema.agentTurns.ordinal, heads.ordinal)))
      .innerJoin(schema.agentSessions, eq(schema.agentSessions.id, heads.sessionId))
      .where(and(isNull(schema.agentSessions.archivedAt), eq(schema.agentSessions.controller, 'acorn')))
    return rows.map(({ session, turn }) => ({ session: mapAgentSession(session), turn: mapAgentTurn(turn) }))
  }

  async hasProviderExecutionHistory(sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        or(
          isNotNull(schema.agentTurns.providerTurnRef),
          inArray(schema.agentTurns.status, ['dispatching', 'active', 'completed', 'failed', 'interrupted']),
        ),
      ))
      .limit(1)
    return row != null
  }

  // Sessions whose roster still holds a child that claims to be working. Filtered in memory after a
  // narrow SQL cut because the roster is a JSON column: on a real installation `!= '[]'` took 278 rows
  // down to 23, and this runs once, at boot.
  async sessionsWithActiveSubagents(): Promise<AgentSession[]> {
    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(and(isNull(schema.agentSessions.archivedAt), ne(schema.agentSessions.subagentsJson, '[]')))
    return rows.map(mapAgentSession).filter((session) => session.subagents.some(isActiveSubagent))
  }

  async unsettledSessions(): Promise<AgentSession[]> {
    const [runtimeRows, turnRows, requestRows] = await Promise.all([
      this.db
      .select()
      .from(schema.agentSessions)
      .where(inArray(schema.agentSessions.runtimeState, [
        'creating',
        'connecting',
        'replaying',
        'working',
        'waiting',
        'cancelling',
        'reconnecting',
      ])),
      this.db
        .selectDistinct({ sessionId: schema.agentTurns.sessionId })
        .from(schema.agentTurns)
        .where(inArray(schema.agentTurns.status, ['dispatching', 'active'])),
      this.db
        .selectDistinct({ sessionId: schema.agentRequests.sessionId })
        .from(schema.agentRequests)
        .where(inArray(schema.agentRequests.status, ['pending', 'resolving'])),
    ])
    const known = new Map(runtimeRows.map((row) => [row.id, row]))
    const missingIds = [...new Set([
      ...turnRows.map((row) => row.sessionId),
      ...requestRows.map((row) => row.sessionId),
    ])].filter((id) => !known.has(id))
    if (missingIds.length) {
      const rows = await this.db
        .select()
        .from(schema.agentSessions)
        .where(inArray(schema.agentSessions.id, missingIds))
      for (const row of rows) known.set(row.id, row)
    }
    return [...known.values()].map(mapAgentSession)
  }

  /** Whether a saved command names this resource, such as the owner's own `agent_cancel` of a turn. */
  async hasOperationFor(command: string, resourceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ key: schema.agentOperations.idempotencyKey })
      .from(schema.agentOperations)
      .where(and(eq(schema.agentOperations.command, command), eq(schema.agentOperations.resourceId, resourceId)))
      .limit(1)
    return row != null
  }

  async countTurns(sessionId: string, source: AgentTurn['source']): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.source, source)))
    return Number(row?.count ?? 0)
  }

  /** Notes one plugin has queued on one session. `sentBy` is host-written, so the count can't be dodged. */
  async countPluginMessages(sessionId: string, pluginId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        eq(schema.agentTurns.source, 'plugin'),
        sql`json_extract(${schema.agentTurns.effectivePolicyJson}, '$.sentBy.pluginId') = ${pluginId}`,
      ))
    return Number(row?.count ?? 0)
  }

  /** The plugin notes that joined one unattended operation, in queue order (./turnFollowUps.ts). */
  async followUpTurns(sessionId: string, originTurnId: string): Promise<AgentTurn[]> {
    const rows = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        eq(schema.agentTurns.source, 'plugin'),
        sql`json_extract(${schema.agentTurns.effectivePolicyJson}, '$.followUpOf') = ${originTurnId}`,
      ))
      .orderBy(asc(schema.agentTurns.ordinal))
    return rows.map(mapAgentTurn)
  }

  /** A workflow step's operation ends with the process, so a note still queued for it would run with
   *  nobody waiting. The step reruns as a new turn after a restart. Startup-only. */
  async cancelWorkflowFollowUps(): Promise<void> {
    const rows = await this.db
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentSessions.id, schema.agentTurns.sessionId))
      .where(and(
        eq(schema.agentSessions.kind, 'workflow'),
        eq(schema.agentTurns.source, 'plugin'),
        eq(schema.agentTurns.status, 'queued'),
      ))
    for (const row of rows) await this.cancelTurn(row.id)
  }

  /** Settled turns an owner queued and asked to hear back about. The LIKE is a narrow cut on a JSON
   *  column; the caller still reads `reportTo` from the parsed policy. Startup-only. */
  async settledReportingTurns(): Promise<AgentTurn[]> {
    const rows = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.source, 'delegation'),
        inArray(schema.agentTurns.status, ['completed', 'failed', 'cancelled', 'interrupted']),
        like(schema.agentTurns.effectivePolicyJson, '%"reportTo":%'),
      ))
    return rows.map(mapAgentTurn)
  }

  /** Startup recovery for checks, including terminal-owned turns that have no report destination. */
  async settledUncheckedDelegationTurns(): Promise<AgentTurn[]> {
    const rows = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.source, 'delegation'),
        inArray(schema.agentTurns.status, ['completed', 'failed', 'cancelled', 'interrupted']),
        sql`json_type(${schema.agentTurns.effectivePolicyJson}, '$.checks') = 'array'`,
        sql`json_type(${schema.agentTurns.effectivePolicyJson}, '$.checkResults') IS NULL`,
      ))
    return rows.map(mapAgentTurn)
  }
}
