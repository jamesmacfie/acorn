import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, isNull, ne, notExists, notInArray } from 'drizzle-orm'
import type { CoreServices, PluginDatabase, SearchHit } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentRequest,
  AgentSession,
  AgentSubagent,
  AgentTurn,
} from '../../contract/wire.ts'
import { AGENT_EVENT_SCHEMA_VERSION, agentEventSearchText } from '../../contract/wire.ts'
import { mapAgentEvent, mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'
import type { RemovedArtifactObject } from './artifactStore'
import { eventSubagentId, foldSubagentRoster, projectAgentEvent, touchSubagentRoster } from './stateMachine'
import type { AgentLifecyclePublisher, AgentSessionChange, SessionRenameSource } from '../../contract/lifecycle'
import { AgentLifecycle } from './lifecycle'
import { continuesStream, isAppendDelta } from './durableEventBuffer'
import { LedgerFold } from './ledgerFold'
import { normalizeStoredSessionTitle } from './sessionTitle'
import type { AgentSearchProjection } from './searchProjection'
import type { SessionSearchFilter } from './sessionSearch'

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

/**
 * Session projection, request-resolution, deletion, and search repository.
 *
 * The event transaction lives here because it is the authority that advances the session sequence
 * and all query projections atomically. It appends, and folds a tool call's or a file change's
 * superseded rows into the new one in the same step (./ledgerFold.ts). Turn queue operations remain in
 * AgentStore; both slices share one inherited database handle.
 *
 * See docs/managed-agents.md § Session model for how a workspace-scoped read resolves task ids
 * through core before filtering this plugin's own tables.
 */
export class AgentSessionRepository {
  protected readonly lifecycle: AgentLifecycle
  private searchProjectionPromise: Promise<AgentSearchProjection> | undefined
  // Which rows each open tool call and file change has, so an update can supersede them (./ledgerFold.ts).
  protected readonly ledgerFold = new LedgerFold()

  constructor(
    protected readonly db: PluginDatabase,
    protected readonly core: CoreServices,
    publishLifecycle?: AgentLifecyclePublisher,
  ) {
    this.lifecycle = new AgentLifecycle(db, publishLifecycle)
  }

  // `null` means no workspace filter. An empty array means the workspace has no tasks, so the query
  // narrows to nothing rather than falling through to unfiltered.
  protected async workspaceTaskIds(workspaceId: string | undefined): Promise<string[] | null> {
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
    const timestamp = now()
    const projection = projectAgentEvent(event, turnId)
    const eventId = randomUUID()
    const committed = this.db.transaction((tx) => {
      const current = tx
        .select({
          lastEventSeq: schema.agentSessions.lastEventSeq,
          configJson: schema.agentSessions.configJson,
          subagentsJson: schema.agentSessions.subagentsJson,
          kind: schema.agentSessions.kind,
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
      // has opened (docs/managed-agents.md § Subagents).
      // An event the harness attributed to a child marks that child heard from, which is what keeps a
      // backgrounded row honest: its own updates stop at the launch receipt, so without this the only
      // clock the roster has is one that stopped ticking minutes ago.
      const touchedId = event.type === 'subagent' ? undefined : eventSubagentId(event)
      const subagentsJson = event.type === 'subagent'
        ? JSON.stringify(foldSubagentRoster(
            parseSubagents(current.subagentsJson),
            event.subagent,
            turnId,
            timestamp,
          ))
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
    return mapAgentEvent(committed.row)
  }

  protected ensureSearchProjection(): Promise<AgentSearchProjection> {
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
          status: 'pending',
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

  async expirePendingRequests(sessionId: string): Promise<void> {
    const requests = await this.db
      .select({ providerRequestId: schema.agentRequests.providerRequestId })
      .from(schema.agentRequests)
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        inArray(schema.agentRequests.status, ['pending', 'resolving']),
      ))
    if (!requests.length) return
    await this.db
      .update(schema.agentRequests)
      .set({ status: 'expired', resolvedAt: now() })
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        inArray(schema.agentRequests.status, ['pending', 'resolving']),
      ))
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

  // Removing a session's history, for the retention pass (docs/data-layer.md § Retention). It works in
  // three steps so the caller can yield between them: find a session, delete its events a batch at a
  // time, then finish it. The session row stays, so an archived or restored task still lists the
  // session, and its transcript says what happened to it.

  /**
   * The oldest session of these tasks whose history is still stored. Never one in `live`, the sessions
   * with a provider process in this node, and never one with a turn being dispatched or running.
   * Synchronous, so a caller can check and write with nothing in between.
   */
  sessionWithHistory(taskIds: readonly string[], live: ReadonlySet<string>): string | null {
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
        isNull(schema.agentSessions.historyRemovedAt),
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

}
