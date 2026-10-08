// A settled host-check report for inspecting the desktop card in an isolated agent session.
import { randomUUID } from 'node:crypto'
import { pastedContent, type CoreServices, type PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentProviderDescriptor, AgentSession } from '../contract/wire.ts'
import { AgentStore } from '../server/sessions/store'

const provider: AgentProviderDescriptor = {
  id: 'claude', profileId: 'claude-code', label: 'Claude Code', driverKind: 'acp',
  driverVersion: 'fixture', installed: true, authenticated: true, statusAuthority: 'protocol',
  capabilities: [], configOptions: [], commands: [], skills: [], diagnostics: [],
}

/** Writes a completed report, with saved holds and fails, through the agents store. */
export async function seedDelegationCheckReport(
  db: PluginDatabase,
  core: CoreServices,
  taskId: string,
): Promise<{ session: AgentSession; turns: number; events: number }> {
  const store = new AgentStore(db, core)
  const session = await store.createSession({
    taskId, providerId: provider.id, profileId: provider.profileId, kind: 'imported',
    title: 'Delegation check report', config: { imported: true, resumeVerified: false, fixture: 'delegation-checks' },
  }, provider)
  await store.setController(session.id, 'external')
  const checkResults = {
    checkedAt: Date.now(), outcome: 'completed' as const, outcomeTurnId: randomUUID(),
    verdicts: [
      { check: { kind: 'file-exists' as const, path: 'README.md' }, status: 'holds' as const, reason: 'Regular file exists.' },
      { check: { kind: 'file-nonempty' as const, path: 'missing.txt' }, status: 'fails' as const, reason: 'File does not exist.' },
    ],
  }
  const text = `Child finished.\n\nFinal message:\n${pastedContent('I wrote both files.')}\n\nHost checks:\n- file-exists README.md: holds\n- file-nonempty missing.txt: fails`
  const { turn } = await store.enqueueTurn(session.id, {
    input: [{ type: 'text', text }], source: 'delegation_report',
    effectivePolicy: { checkResults }, idempotencyKey: randomUUID(),
  })
  await store.dispatchTurn(turn.id)
  await store.startTurn(turn.id)
  await store.recordEvent(session.id, turn.id, { type: 'user_message', text })
  await store.recordEvent(session.id, turn.id, { type: 'turn_completed', stopReason: 'end_turn' })
  await store.recordEvent(session.id, null, { type: 'session_state', state: 'stopped', detail: 'Delegation check fixture.' })
  return { session: await store.requireSession(session.id), turns: 1, events: 3 }
}
