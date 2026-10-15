// A finished session written through this plugin's own store, the way an imported transcript is
// (`importTranscript`): a session row, then per turn an enqueue, a dispatch, a start, and its events.
// So the session, turn, event and request rows relate exactly as they do for a real run. The session
// ends `stopped`, so a node booting over it has nothing to recover.
//
// Test scaffolding: imported by the fixture seeders only.
import { randomUUID } from 'node:crypto'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent, AgentProviderDescriptor, AgentSession, AgentSessionKind } from '../contract/wire.ts'
import { AgentStore } from '../server/sessions/store'

/** One turn: what the person sent, and every event the turn recorded, starting with that message. */
export type TranscriptTurn = { user: string; events: AgentNormalizedEvent[] }

const PROVIDER: AgentProviderDescriptor = {
  id: 'claude',
  profileId: 'claude-code',
  label: 'Claude Code',
  driverKind: 'acp',
  driverVersion: 'fixture',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

/** Writes `turns` as one Claude Code session on `taskId`. An `imported` session is read-only history
 *  controlled from outside acorn, so nothing tries to resume it. An `interactive` one shows a composer
 *  ready for the next message. */
export async function seedTranscript(
  db: PluginDatabase,
  core: CoreServices,
  input: {
    taskId: string
    title: string
    kind: Extract<AgentSessionKind, 'imported' | 'interactive'>
    config: Record<string, unknown>
    turns: readonly TranscriptTurn[]
    detail: string
  },
): Promise<{ session: AgentSession; turns: number; events: number }> {
  const store = new AgentStore(db, core)
  const imported = input.kind === 'imported'
  const session = await store.createSession(
    {
      taskId: input.taskId,
      providerId: PROVIDER.id,
      profileId: PROVIDER.profileId,
      kind: input.kind,
      title: input.title,
      config: input.config,
    },
    PROVIDER,
  )
  if (imported) await store.setController(session.id, 'external')
  let events = 0
  for (const turnInput of input.turns) {
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: turnInput.user }],
      source: imported ? 'import' : 'interactive',
      effectivePolicy: imported ? { imported: true } : {},
      idempotencyKey: randomUUID(),
    })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    for (const event of turnInput.events) {
      await store.recordEvent(session.id, turn.id, event)
      events++
    }
  }
  await store.recordEvent(session.id, null, { type: 'session_state', state: 'stopped', detail: input.detail })
  return { session: await store.requireSession(session.id), turns: input.turns.length, events: events + 1 }
}
