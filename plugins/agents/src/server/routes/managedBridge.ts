// The ManagedAgentsBridge, built over a ManagedAgentRuntime.
//
// It sits beside the routes, not in node/index.ts, because it is the error taxonomy that turns the
// runtime's thrown messages into the status codes managed.ts promises. node/index.ts owns composition,
// not HTTP semantics.
import { BridgeError } from '@acorn/plugin-api/node'
import type { AgentRuntimeState } from '@acorn/protocol/managedAgents.ts'
import type { RunStatus } from '@acorn/protocol/runs.ts'
import { foldUsageEvents } from '../../shared/usageFold'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import type { AgentDelegationService } from '../delegation/service'
import type { ManagedAgentsBridge } from './managed'

// The runtime throws plain Errors and has no idea it is behind HTTP, so the mapping goes by message
// shape. An unmatched error rethrows and becomes a 500, which is the honest answer for a bug.
function bridgeFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Managed agent operation failed.'
  if (/not found/i.test(message)) throw new BridgeError(404, 'agent_not_found', message)
  if (/not available|unavailable|no mapped checkout/i.test(message)) {
    throw new BridgeError(422, 'agent_provider_unavailable', message)
  }
  if (/active turn|not ready|controlled|archived|pending|support/i.test(message)) {
    throw new BridgeError(409, 'agent_conflict', message)
  }
  throw error
}

const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    return bridgeFailure(error)
  }
}

// How many sessions this plugin offers the merged list. Same reasoning as the workflows half: it is a
// "what is happening now" surface, not an archive.
const RUN_LIST_LIMIT = 100

const TERMINAL_AGENT_STATES = new Set<AgentRuntimeState>(['stopped', 'failed', 'archived'])

const toRunStatus = (state: AgentRuntimeState): RunStatus => {
  if (state === 'failed') return 'failed'
  if (state === 'stopped' || state === 'archived') return 'done'
  // Connected and idle, or blocked on a permission or a question: both are "somebody has to do
  // something before this moves".
  if (state === 'ready' || state === 'waiting') return 'waiting'
  return 'running'
}

export function managedAgentsBridge(
  runtime: ManagedAgentRuntime,
  delegation?: Pick<AgentDelegationService, 'projectSessionList'>,
): ManagedAgentsBridge {
  // Not wrapped in `guarded`. These answer the router's authorization question, and bridgeFailure would
  // turn a "not found" into a thrown BridgeError(404), skipping the comparison the guard needs to make.
  const taskIdForSession = async (sessionId: string) => (await runtime.store.getSession(sessionId))?.taskId ?? null
  return {
    taskIdForSession,
    taskIdForAttachment: async (attachmentId) => (await runtime.attachments.get(attachmentId))?.taskId ?? null,
    // Two hops: an artifact belongs to a session, and the session names the task.
    taskIdForArtifact: async (artifactId) => {
      const sessionId = (await runtime.artifacts.get(artifactId))?.sessionId
      return sessionId ? await taskIdForSession(sessionId) : null
    },
    providers: (force) => guarded(() => runtime.providers(force)),
    // A session projected to the merged run list's shape (@acorn/protocol/runs.ts). Live sessions
    // only: the list answers "what is happening on this node", and an archived session is history the
    // Agents pane already shows in full.
    //
    // Eleven runtime states collapse to four here, and the join is the useful part: `ready` and
    // `waiting` both mean blocked on a person, which is the state an owner scanning the list is
    // looking for.
    runs: async () => {
      const { sessions } = await guarded(() => runtime.store.listSessions({ archived: false, limit: RUN_LIST_LIMIT }))
      return {
        runs: sessions.map((session) => ({
          id: session.id,
          title: session.title,
          status: toRunStatus(session.runtimeState),
          startedAt: session.createdAt,
          endedAt: TERMINAL_AGENT_STATES.has(session.runtimeState) ? session.updatedAt : null,
          taskId: session.taskId,
          // No cost. It lives per turn inside `usage_json`, and parsing every turn to draw a list is
          // the wrong trade (routes/managed.ts § /runs).
          costUsd: null,
          detail: session.model ? `${session.providerId} · ${session.model}` : session.providerId,
        })),
      }
    },
    uploadAttachment: (taskId, filename, mediaType, bytes) =>
      guarded(() => runtime.attachments.upload(taskId, filename, mediaType, bytes)),
    attachment: (attachmentId) => guarded(() => runtime.attachments.get(attachmentId)),
    removeAttachment: (attachmentId) => guarded(() => runtime.attachments.removeUnreferenced(attachmentId)),
    artifacts: (sessionId) => guarded(() => runtime.artifacts.list(sessionId)),
    artifact: (artifactId) => guarded(() => runtime.artifacts.get(artifactId)),
    artifactContent: (artifactId) => guarded(() => runtime.artifacts.read(artifactId)),
    // A device needs the durable row so it can select the conversation while the provider connects.
    // Workflow execution bypasses this HTTP bridge and keeps runtime.createSession's ready-on-return
    // contract (../sessions/sessionExecute.ts).
    createSession: (input, idempotencyKey) => guarded(() => runtime.acceptSession(input, idempotencyKey)),
    importTranscript: (input) => guarded(() => runtime.importTranscript(input)),
    verifyImportedResume: (sessionId) => guarded(() => runtime.verifyImportedResume(sessionId)),
    listSessions: (filter) => guarded(async () => {
      const page = await runtime.store.listSessions(filter)
      return delegation ? delegation.projectSessionList(page) : page
    }),
    // Folded here rather than in the store, because this is the one caller whose reader folds anyway.
    // `store.snapshot` still answers workflow execution and the wait route with every row
    // (../../shared/usageFold.ts says why, ../sessions/sessionExecute.ts is the caller that needs them).
    snapshot: (sessionId, afterSeq, eventLimit) => guarded(async () => {
      const snapshot = await runtime.store.snapshot(sessionId, afterSeq, eventLimit)
      return { ...snapshot, events: foldUsageEvents(snapshot.events) }
    }),
    events: (sessionId, afterSeq, limit) => guarded(() => runtime.store.eventPage(sessionId, afterSeq, limit)),
    enqueueTurn: (sessionId, input) => guarded(() => runtime.enqueueTurn(sessionId, input)),
    patchQueuedTurn: (sessionId, turnId, patch) =>
      guarded(() => runtime.patchQueuedTurn(sessionId, turnId, patch)),
    cancelTurn: (sessionId, turnId) => guarded(() => runtime.cancelTurn(sessionId, turnId)),
    resolveRequest: (sessionId, requestId, resolution, idempotencyKey) =>
      guarded(() => runtime.resolveRequest(sessionId, requestId, resolution, idempotencyKey)),
    patchSession: (sessionId, patch) => guarded(() => runtime.patchSession(sessionId, patch)),
    fork: (sessionId, title) => guarded(() => runtime.fork(sessionId, title)),
    compact: (sessionId) => guarded(() => runtime.compact(sessionId)),
    regenerateTitle: (sessionId) => guarded(() => runtime.regenerateTitle(sessionId)),
    deleteSession: (sessionId) => guarded(() => runtime.deleteSession(sessionId)),
    handoffToTerminal: (sessionId) => guarded(() => runtime.handoffToTerminal(sessionId)),
    resumeManaged: (sessionId) => guarded(() => runtime.resumeManaged(sessionId)),
    exportSession: (sessionId, format) => guarded(() => runtime.exportSession(sessionId, format)),
    wait: (sessionId, afterSeq, until, timeoutMs) =>
      guarded(() => runtime.wait(sessionId, afterSeq, until, timeoutMs)),
    search: (query, filter) => guarded(() => runtime.store.searchSessions(query, filter)),
  }
}
