// The ManagedAgentsBridge, built over a ManagedAgentRuntime.
//
// Moved out of apps/node/src/wiring/managedAgentsWiring.ts, where it lived because the app was what
// constructed the runtime. It lands beside the routes rather than in the plugin's node/index.ts on
// purpose: what it really is, is the error taxonomy that turns the runtime's thrown messages into the
// status codes managed.ts's handlers promise. Keeping that next to the router is what makes the mapping
// reviewable against the surface it shapes; node/index.ts owns composition, not HTTP semantics.
import { BridgeError } from '@acorn/node-core/server/bridge.ts'
import type { ManagedAgentRuntime } from '../../main/runtime'
import type { ManagedAgentsBridge } from './managed'

// The runtime throws plain Errors — it has no idea it is behind HTTP — so the mapping is by message
// shape. Deliberately unchanged in this move, including its bluntness: an unmatched error rethrows and
// becomes a 500, which is the honest answer for a bug rather than a guessed 4xx.
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

export function managedAgentsBridge(runtime: ManagedAgentRuntime): ManagedAgentsBridge {
  return {
    providers: (force) => guarded(() => runtime.providers(force)),
    uploadAttachment: (taskId, filename, mediaType, bytes) =>
      guarded(() => runtime.attachments.upload(taskId, filename, mediaType, bytes)),
    attachment: (attachmentId) => guarded(() => runtime.attachments.get(attachmentId)),
    removeAttachment: (attachmentId) => guarded(() => runtime.attachments.removeUnreferenced(attachmentId)),
    artifacts: (sessionId) => guarded(() => runtime.artifacts.list(sessionId)),
    artifact: (artifactId) => guarded(() => runtime.artifacts.get(artifactId)),
    artifactContent: (artifactId) => guarded(() => runtime.artifacts.read(artifactId)),
    createSession: (input, idempotencyKey) => guarded(() => runtime.createSession(input, idempotencyKey)),
    importTranscript: (input) => guarded(() => runtime.importTranscript(input)),
    verifyImportedResume: (sessionId) => guarded(() => runtime.verifyImportedResume(sessionId)),
    listSessions: (filter) => guarded(() => runtime.store.listSessions(filter)),
    snapshot: (sessionId, afterSeq, eventLimit) => guarded(() => runtime.store.snapshot(sessionId, afterSeq, eventLimit)),
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
    deleteSession: (sessionId) => guarded(() => runtime.deleteSession(sessionId)),
    handoffToTerminal: (sessionId) => guarded(() => runtime.handoffToTerminal(sessionId)),
    resumeManaged: (sessionId) => guarded(() => runtime.resumeManaged(sessionId)),
    exportSession: (sessionId, format) => guarded(() => runtime.exportSession(sessionId, format)),
    wait: (sessionId, afterSeq, until, timeoutMs) =>
      guarded(() => runtime.wait(sessionId, afterSeq, until, timeoutMs)),
    search: (query, filter) => guarded(() => runtime.store.searchSessions(query, filter)),
  }
}
