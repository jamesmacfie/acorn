import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor, AgentSessionKind } from '../../contract/wire.ts'
import { persistedAttendance } from './attendance'
import { attendanceInstructions } from './attendanceInstructions'
import { AgentStore } from './store'

const provider: AgentProviderDescriptor = {
  id: 'fake', profileId: 'fake', label: 'Fake', driverKind: 'acp', driverVersion: '1',
  installed: true, authenticated: true, statusAuthority: 'protocol', capabilities: [],
  configOptions: [], commands: [], skills: [], diagnostics: [],
}

describe('persisted turn attendance', () => {
  let ctx: TestNodeContext
  let store: AgentStore
  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })
  afterEach(() => ctx.cleanup())

  async function session(kind: AgentSessionKind, posture?: 'gated' | 'autonomous') {
    return store.createSession({ taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind, config: {} }, provider, posture)
  }
  async function turn(kind: AgentSessionKind, posture?: 'gated' | 'autonomous') {
    const target = await session(kind, posture)
    const accepted = await store.enqueueTurn(target.id, {
      source: kind === 'workflow' ? 'workflow' : kind === 'delegated' ? 'delegation' : 'interactive',
      input: [{ type: 'text', text: 'Work' }], effectivePolicy: { attendance: 'autonomous' },
      idempotencyKey: randomUUID(),
    }, { posture })
    return { session: target, turn: accepted.turn }
  }

  it('ignores a caller policy value and resolves each session and workflow posture', async () => {
    expect((await turn('interactive')).turn.effectivePolicy.attendance).toBe('attended')
    expect((await turn('imported')).turn.effectivePolicy.attendance).toBe('attended')
    expect((await turn('delegated')).turn.effectivePolicy.attendance).toBe('supervised')
    expect((await turn('workflow', 'gated')).turn.effectivePolicy.attendance).toBe('supervised')
    expect((await turn('workflow', 'autonomous')).turn.effectivePolicy.attendance).toBe('autonomous')
  })

  it('inherits autonomous attendance on follow-ups and continuations after reloading the turn', async () => {
    const first = await turn('workflow', 'autonomous')
    store = new AgentStore(ctx.storage.open(), ctx.core)
    for (const [source, field] of [['plugin', 'followUpOf'], ['workflow', 'continuationOf']] as const) {
      const next = await store.enqueueTurn(first.session.id, {
        source, input: [{ type: 'text', text: 'Continue' }],
        effectivePolicy: { [field]: first.turn.id, attendance: 'attended' }, idempotencyKey: randomUUID(),
      }, { originTurnId: first.turn.id })
      expect(persistedAttendance((await store.turn(next.turn.id))!.effectivePolicy)).toBe('autonomous')
    }
  })

  it('rejects unknown posture and attendance values', async () => {
    const target = await session('workflow')
    await expect(store.enqueueTurn(target.id, {
      source: 'workflow', input: [], effectivePolicy: {}, idempotencyKey: randomUUID(),
    }, { posture: 'unknown' as 'gated' })).rejects.toThrow('Unknown workflow posture')
    expect(() => persistedAttendance({ attendance: 'unknown' })).toThrow('Invalid persisted turn attendance')
  })

  it('captures goal policy through the same store boundary and keeps goals interactive', async () => {
    const target = await session('interactive')
    const accepted = await store.enqueueTurn(target.id, {
      source: 'goal', input: [{ type: 'text', text: 'Keep working' }], effectivePolicy: {}, idempotencyKey: randomUUID(),
    })
    expect(accepted.turn.effectivePolicy).toMatchObject({
      attendance: 'attended', providerAdvertisedPolicy: [], providerStatusAuthority: 'protocol', capturedAt: expect.any(Number),
    })
    const workflow = await turn('workflow', 'autonomous')
    await expect(store.enqueueTurn(workflow.session.id, {
      source: 'goal', input: [], effectivePolicy: {}, idempotencyKey: randomUUID(),
    }, { originTurnId: workflow.turn.id })).rejects.toThrow('Goals require an interactive session')
  })

  it('backfills a legacy queued turn durably and rejects an explicit unknown value', async () => {
    const first = await turn('interactive')
    const autonomous = await turn('workflow', 'autonomous')
    ctx.storage.open().$client.prepare('UPDATE agent_turns SET effective_policy_json = ? WHERE id = ?').run('{}', autonomous.turn.id)
    await store.restoreTurnAttendance(autonomous.turn.id)
    expect((await store.turn(autonomous.turn.id))?.effectivePolicy.attendance).toBe('autonomous')
    ctx.storage.open().$client.prepare('UPDATE agent_turns SET effective_policy_json = ? WHERE id = ?').run('{}', first.turn.id)
    await store.restoreTurnAttendance(first.turn.id)
    expect((await store.turn(first.turn.id))?.effectivePolicy.attendance).toBe('attended')
    ctx.storage.open().$client.prepare('UPDATE agent_turns SET effective_policy_json = ? WHERE id = ?')
      .run('{"attendance":"unknown"}', first.turn.id)
    await expect(store.restoreTurnAttendance(first.turn.id)).rejects.toThrow('Invalid persisted turn attendance')
  })

  it('instructs supervised and autonomous turns without changing attended prompts', () => {
    expect(attendanceInstructions('attended')).toBeNull()
    expect(attendanceInstructions('supervised')).toContain('A message with no tool call in it ends your turn')
    expect(attendanceInstructions('autonomous')).toContain('BLOCKED:')
  })
})
