import { randomUUID } from 'node:crypto'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentProviderDescriptor } from '../contract/wire'
import { AgentStore } from '../server/sessions/store'

const provider: AgentProviderDescriptor = {
  id: 'codex',
  profileId: 'codex',
  label: 'Codex',
  driverKind: 'codex-app-server',
  driverVersion: 'fixture',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: ['resume', 'tool_calls'],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

/** Seed missing command endings and one queued real-provider turn before Node startup. */
export async function seedCommandRestart(db: PluginDatabase, core: CoreServices, taskId: string) {
  const store = new AgentStore(db, core)
  const session = await store.createSession(
    { taskId, providerId: 'codex', profileId: 'codex', kind: 'interactive', title: 'Restarted command', config: {} },
    provider,
  )
  const enqueue = (sessionId: string, text: string) =>
    store.enqueueTurn(sessionId, {
      source: 'interactive',
      input: [{ type: 'text', text }],
      effectivePolicy: {},
      idempotencyKey: randomUUID(),
    })
  const { turn } = await enqueue(session.id, 'Run the command before the Node exits.')
  await store.startTurn(turn.id)
  await store.recordEvent(session.id, turn.id, { type: 'user_message', text: 'Run the command before the Node exits.' })
  await store.recordEvent(session.id, turn.id, {
    type: 'tool',
    tool: {
      id: 'restart-command',
      title: 'Command output',
      kind: 'execute',
      status: 'running',
      input: 'sleep 30',
      output: 'RESTART_OUTPUT_PRESERVED',
    },
  })
  const completed = await store.createSession(
    {
      taskId,
      providerId: 'codex',
      profileId: 'codex',
      kind: 'imported',
      title: 'Missing command completion',
      config: { imported: true },
    },
    provider,
  )
  const { turn: finished } = await enqueue(completed.id, 'The turn ends without a command completion notification.')
  await store.startTurn(finished.id)
  await store.recordEvent(completed.id, finished.id, {
    type: 'user_message',
    text: 'The turn ends without a command completion notification.',
  })
  await store.recordEvent(completed.id, finished.id, {
    type: 'tool',
    tool: {
      id: 'missing-completion',
      title: 'Command output',
      kind: 'execute',
      status: 'running',
      output: 'MISSING_COMPLETION_OUTPUT',
    },
  })
  await store.recordEvent(completed.id, finished.id, { type: 'turn_completed', stopReason: 'completed' })
  await store.recordEvent(completed.id, null, { type: 'session_state', state: 'stopped' })
  const queued = await store.createSession(
    { taskId, providerId: 'codex', profileId: 'codex', kind: 'interactive', title: 'Queued after restart', config: {} },
    provider,
  )
  await store.recordEvent(queued.id, null, { type: 'session_state', state: 'stopped' })
  await enqueue(
    queued.id,
    'Use your shell tool to run exactly: printf "QUEUE_START\\n"; sleep 90; printf "QUEUE_DONE\\n". Do not create agents or modify files. Then reply "Queue verified".',
  )
  return { session: await store.requireSession(session.id), turns: 3, events: 8 }
}
