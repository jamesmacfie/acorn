// A long managed-agent session for the large-surface fixture (docs/testing.md § Large-surface fixture).
//
// Generated from a seed and written through this plugin's own store, the way an imported transcript
// is (../server/sessions/runtime.ts § importTranscript): a session row, then per turn an enqueue, a
// dispatch, a start, its events, and `turn_completed`. So the session, turn, event and request rows
// relate exactly as they do for a real run, and the client's `loadSnapshot` pages through it the same
// way. The session ends `stopped` and every request is resolved, so a node booting over it has
// nothing to recover.
//
// Test scaffolding: imported by tests and the agent-automation seeder only.
import { randomUUID } from 'node:crypto'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent, AgentProviderDescriptor, AgentSession } from '../contract/wire.ts'
import { AgentStore } from '../server/sessions/store'

export type LargeSessionProfile = 'small' | 'scale' | 'canonical'

/** Turns per profile, or a floor of events for the canonical one: the managed-agent docs' 7,000-event
 *  session, which projects to well over the 1,200 cards the programme asks for. */
export const LARGE_SESSION_PROFILES: Record<LargeSessionProfile, { turns: number; events?: number }> = {
  small: { turns: 19 },
  scale: { turns: 94 },
  canonical: { turns: Infinity, events: 7_000 },
}

export type LargeSessionTurn = { user: string; events: AgentNormalizedEvent[] }

const CODE = [
  '```ts',
  'export function settle(queue: string[], budget: number): string[] {',
  '  const done: string[] = []',
  '  while (queue.length && done.length < budget) done.push(queue.shift()!)',
  '  return done',
  '}',
  '```',
].join('\n')

/** The oldest turn carries this, so a flow has something distinctive to reveal at the far end. */
export const LARGE_SESSION_OLDEST_MARKER = 'Oldest turn in the fixture session'

/**
 * Every turn of one profile, deterministic from the seed. Numbers come from the turn index and the
 * seed only, so two runs write the same ledger apart from the row ids the store assigns.
 */
export function largeSessionTurns(profile: LargeSessionProfile, seed = 1): LargeSessionTurn[] {
  const shape = LARGE_SESSION_PROFILES[profile]
  const turns: LargeSessionTurn[] = []
  let events = 0
  for (let index = 0; index < shape.turns && (shape.events === undefined || events < shape.events); index++) {
    const tag = `${seed}-${index}`
    const message = `message-${tag}`
    const list: AgentNormalizedEvent[] = [
      { type: 'user_message', text: index === 0 ? `${LARGE_SESSION_OLDEST_MARKER}. Start the review.` : `Turn ${index}: continue with the next file.` },
      { type: 'reasoning', text: `Reading the diff for turn ${index}. `, messageId: `reasoning-${tag}` },
      { type: 'reasoning', text: 'Checking the queue bound before editing.', messageId: `reasoning-${tag}`, append: true },
    ]
    for (let tool = 0; tool < 3; tool++) {
      const id = `tool-${tag}-${tool}`
      const title = `Read src/pkg-${(index + tool) % 40}/module-${index}.ts`
      list.push({ type: 'tool', tool: { id, title, kind: 'read', status: 'running', input: `{"path":"src/module-${index}.ts"}` } })
      list.push({ type: 'tool', tool: { id, title, status: 'completed', output: tool === 2 && index % 5 === 0 ? CODE : `Read ${40 + tool} lines.` } })
    }
    if (index % 4 === 1) {
      const requestId = `request-${tag}`
      list.push({ type: 'request', requestId, kind: 'permission', title: 'Run the test suite?', options: [{ id: 'allow', label: 'Allow once', kind: 'allow_once' }, { id: 'reject', label: 'Reject', kind: 'reject_once' }] })
      list.push({ type: 'request_resolved', requestId, resolution: { optionId: 'allow' } })
    }
    if (index % 10 === 3) {
      const id = `subagent-${tag}`
      list.push({ type: 'subagent', subagent: { id, title: `Explore module ${index}`, status: 'running', role: 'Explore' } })
      list.push({ type: 'subagent', subagent: { id, status: 'completed', toolUseCount: 4, durationMs: 1_200 } })
    }
    list.push({ type: 'assistant_message', text: `Turn ${index} summary. `, messageId: message })
    list.push({ type: 'assistant_message', text: 'The change keeps the queue bounded, ', messageId: message, append: true })
    list.push({ type: 'assistant_message', text: index % 5 === 0 ? `and here is the shape:\n\n${CODE}\n` : 'and nothing else moved.', messageId: message, append: true })
    list.push({ type: 'usage', usage: { inputTokens: 1_000 + index, outputTokens: 200 + index, contextUsed: 20_000 + index * 10, contextSize: 200_000 } })
    list.push({ type: 'turn_completed', stopReason: 'end_turn' })
    events += list.length
    turns.push({ user: list[0]!.type === 'user_message' ? list[0]!.text : '', events: list })
  }
  return turns
}

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

/**
 * Write one generated session for `taskId` into this plugin's database. Read-only history, like an
 * imported transcript, so nothing tries to resume it.
 */
export async function seedLargeSession(
  db: PluginDatabase,
  core: CoreServices,
  input: { taskId: string; profile: LargeSessionProfile; seed?: number; title?: string },
): Promise<{ session: AgentSession; turns: number; events: number }> {
  const store = new AgentStore(db, core)
  const turns = largeSessionTurns(input.profile, input.seed)
  const session = await store.createSession({
    taskId: input.taskId,
    providerId: PROVIDER.id,
    profileId: PROVIDER.profileId,
    kind: 'imported',
    title: input.title ?? `Large-surface fixture (${input.profile})`,
    config: { imported: true, resumeVerified: false, fixture: 'large-surfaces' },
  }, PROVIDER)
  await store.setController(session.id, 'external')
  let events = 0
  for (const generated of turns) {
    const { turn } = await store.enqueueTurn(session.id, {
      input: [{ type: 'text', text: generated.user }],
      source: 'import',
      effectivePolicy: { imported: true },
      idempotencyKey: randomUUID(),
    })
    await store.dispatchTurn(turn.id)
    await store.startTurn(turn.id)
    for (const event of generated.events) {
      await store.recordEvent(session.id, turn.id, event)
      events++
    }
  }
  await store.recordEvent(session.id, null, { type: 'session_state', state: 'stopped', detail: 'Large-surface fixture.' })
  return { session: await store.requireSession(session.id), turns: turns.length, events: events + 1 }
}
