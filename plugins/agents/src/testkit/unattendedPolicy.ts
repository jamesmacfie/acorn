import { randomUUID } from 'node:crypto'
import { agentProfileRegistry, type CompiledCoreServices, type PluginDatabase, type SecretService } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent, AgentProviderDescriptor, AgentSession } from '../contract/wire.ts'
import type { AgentDriverEvent, AgentDriverSession } from '../server/drivers/types'
import { AgentDriverRegistry } from '../server/drivers/registry'
import { ManagedAgentRuntime } from '../server/sessions/runtime'
import { createSessionExecute } from '../server/sessions/sessionExecute'

const provider: AgentProviderDescriptor = {
  id: 'claude', profileId: 'claude-code', label: 'Unattended fixture', driverKind: 'acp', driverVersion: 'fixture',
  installed: true, authenticated: true, statusAuthority: 'protocol', capabilities: ['permissions', 'questions'],
  configOptions: [], commands: [], skills: [], diagnostics: [],
}

/** Execute synthetic requests through the runtime, then leave its saved transcript for desktop inspection. */
export async function seedUnattendedPolicy(options: {
  db: PluginDatabase; core: CompiledCoreServices; secrets: SecretService; dataDir: string; taskId: string; taskRoot: string
}): Promise<{ session: AgentSession; turns: number; events: number }> {
  const answers: unknown[] = []
  const registry = new AgentDriverRegistry()
  registry.registerNative(provider.id, () => ({
    providerId: provider.id, profileId: provider.profileId, probe: async () => provider,
    start: async (start): Promise<AgentDriverSession> => {
      await start.onEvent({ type: 'session_state', state: 'ready' })
      return {
        providerSessionRef: null, ready: true,
        sendTurn: async () => {
          for (const kind of ['permission', 'question', 'elicitation'] as const) {
            const request: Extract<AgentNormalizedEvent, { type: 'request' }> = {
              type: 'request', requestId: randomUUID(), kind,
              title: kind === 'permission' ? 'Fixture permission' : kind === 'question' ? 'Fixture question' : 'Fixture form',
              ...(kind === 'permission' ? { options: [
                { id: 'allow', label: 'Allow', kind: 'allow_once' as const },
                { id: 'reject', label: 'Reject', kind: 'reject_once' as const },
              ] } : {}),
            }
            let open = true
            const event: AgentDriverEvent = {
              ...(kind === 'permission'
                ? { type: 'permission_request' as const, subject: { toolCallId: request.requestId, kind: 'command' as const, command: 'fixture', paths: [] } }
                : { type: 'input_request' as const }),
              request, open: () => open,
              respond: (resolution) => { open = false; answers.push(resolution) },
            }
            await start.onEvent(event)
            if (open) throw new Error('The autonomous fixture left a request waiting.')
          }
          await start.onEvent({ type: 'assistant_message', text: 'BLOCKED: The fixture needs a deployment target from the owner.' })
          await start.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
          return {}
        },
        cancel: async () => {}, resolveRequest: async () => {}, stop: async () => {},
      }
    },
  }))
  const releaseProfile = agentProfileRegistry.register({
    id: provider.profileId, label: provider.label, kind: 'agent', command: 'fixture', backendPreference: 'tmux',
    transport: 'pty', managedProvider: provider.id,
  })
  const core: CompiledCoreServices = { ...options.core, tasks: {
    ...options.core.tasks, requireRoot: async () => options.taskRoot, workspaceId: async () => 'fixture',
  } }
  const runtime = new ManagedAgentRuntime({
    ...options, core, registry, internalEnv: () => ({}), currentUserId: () => null,
  })
  try {
    const result = await createSessionExecute(runtime)({
      taskId: options.taskId, profileId: provider.profileId, title: 'Unattended request policy',
      prompt: 'Exercise the autonomous permission, question, and form policy.', posture: 'autonomous', timeoutMs: 5_000,
    })
    if (result?.status !== 'error' || !result.stderrTail.startsWith('BLOCKED:') || !result.agentSessionId) {
      throw new Error('The autonomous fixture did not finish as blocked.')
    }
    const snapshot = await runtime.store.snapshot(result.agentSessionId)
    if (snapshot.turns.length !== 1 || snapshot.requests.length !== 3 || snapshot.requests.some((request) => request.status !== 'resolved')) {
      throw new Error('The autonomous fixture left a continuation or pending request.')
    }
    if (answers.length !== 3 || (answers[0] as { optionId?: string }).optionId !== 'reject'
      || answers.slice(1).some((answer) => !(answer as { cancelled?: boolean }).cancelled)) {
      throw new Error('The autonomous fixture returned an unexpected response.')
    }
    await runtime.store.patchSession(snapshot.session.id, { config: { ...snapshot.session.config, fixture: 'unattended-policy' } })
    return { session: snapshot.session, turns: snapshot.turns.length, events: snapshot.events.length }
  } finally {
    await runtime.stop()
    releaseProfile()
  }
}
