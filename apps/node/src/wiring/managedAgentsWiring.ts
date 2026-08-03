import { BridgeError } from '@acorn/node-core/server/bridge.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { wsBroadcast } from '@acorn/node-core/main/wsHub.ts'
import { AGENTS_SESSION_EXECUTE } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { createSessionExecute } from '@acorn/plugin-agents/main/sessionExecute.ts'
import { ManagedAgentRuntime } from '@acorn/plugin-agents/main/runtime.ts'
import { agentDriverRegistry } from '@acorn/plugin-agents/main/drivers/registry.ts'
import { ClaudeAgentDriver } from '@acorn/plugin-agents/main/drivers/claudeDriver.ts'
import { CodexAgentDriver } from '@acorn/plugin-agents/main/drivers/codexDriver.ts'
import { terminalBridgeSlot } from '@acorn/plugin-terminal/server/routes/terminal.ts'
import { getProfile, resolveCommand } from '@acorn/node-core/main/profiles.ts'
import {
  setManagedAgentsBridge,
  type ManagedAgentsBridge,
} from '@acorn/plugin-agents/server/routes/managed.ts'

let driversRegistered = false

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

async function startTerminalHandoff(session: Parameters<NonNullable<
  ConstructorParameters<typeof ManagedAgentRuntime>[0]['startTerminalHandoff']
>>[0]): Promise<string> {
  if (!session.providerSessionRef) throw new Error('The provider session cannot be resumed in a terminal.')
  const profile = getProfile(session.profileId)
  if (profile.id !== session.profileId || !profile.resumeArgv) {
    throw new Error(`Profile '${session.profileId}' does not support terminal resume.`)
  }
  const bridge = terminalBridgeSlot.get()
  if (!bridge) throw new Error('Terminal engine is unavailable.')
  const resume = profile.resumeArgv(resolveCommand(profile), session.providerSessionRef)
  const terminal = await bridge.create({
    taskId: session.taskId,
    profileId: session.profileId,
    title: `${session.title} · terminal`,
    command: [resume.file, ...resume.args].map(shellQuote).join(' '),
    agentSessionId: session.id,
  })
  return terminal.id
}

function registerBuiltInDrivers(): void {
  if (driversRegistered) return
  driversRegistered = true
  agentDriverRegistry.register('claude', () => new ClaudeAgentDriver())
  agentDriverRegistry.register('codex', () => new CodexAgentDriver())
}

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

export function wireManagedAgents(options: {
  db: AppDatabase
  dataDir: string
  internalApiEnv: Record<string, string>
  encryptionKey: string
  capabilities: CapabilityRegistry
  currentUserId(): string | null
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
}): ManagedAgentRuntime {
  registerBuiltInDrivers()
  const runtime = new ManagedAgentRuntime({
    ...options,
    publish: (frame) => wsBroadcast(frame),
    startTerminalHandoff,
    terminalHandoffRunning: async (sessionId) => {
      const bridge = terminalBridgeSlot.get()
      if (!bridge) return false
      return (await bridge.list()).some((terminal) =>
        terminal.agentSessionId === sessionId && terminal.status === 'running')
    },
    onCompletedTurn: options.memoryReviewTrigger,
  })
  const bridge: ManagedAgentsBridge = {
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
  setManagedAgentsBridge(bridge)
  // agents.sessionExecute (plugins/agents/src/contract/sessionExecute.ts). Workflows resolves this at
  // call time and falls back to its own headless runner when it is absent, so a node with the agents
  // plugin unavailable still runs non-managed workflow steps.
  options.capabilities.provide(AGENTS_SESSION_EXECUTE, createSessionExecute(runtime))
  return runtime
}
