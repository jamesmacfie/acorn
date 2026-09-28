import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { codexPlanHandoffState } from '../../shared/codexPlanHandoff'
import { AgentStore } from './store'

const PROVIDER: AgentProviderDescriptor = {
  id: 'codex', profileId: 'codex', label: 'Codex', driverKind: 'codex-app-server',
  driverVersion: '1', installed: true, authenticated: true, statusAuthority: 'protocol',
  capabilities: ['modes', 'plans'], configOptions: [], commands: [], skills: [], diagnostics: [],
}

describe('Codex plan handoff', () => {
  let ctx: TestNodeContext
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })
  afterEach(() => ctx.cleanup())

  async function completedPlan() {
    const session = await store.createSession({
      taskId: randomUUID(), providerId: 'codex', profileId: 'codex', kind: 'interactive',
      config: {
        draftSetting: 'keep',
        configOptions: [
          { id: 'mode', label: 'Mode', category: 'mode', currentValue: 'plan', values: [
            { value: 'plan', label: 'Plan' }, { value: 'default', label: 'Default' },
          ] },
          { id: 'model', label: 'Model', category: 'model', currentValue: 'gpt-6', values: [] },
          { id: 'reasoning', label: 'Effort', category: 'reasoning', currentValue: 'high', values: [] },
        ],
      },
    }, PROVIDER)
    const { turn } = await store.enqueueTurn(session.id, {
      source: 'interactive', input: [{ type: 'text', text: 'Plan this work' }],
      effectivePolicy: { mode: 'plan', model: 'gpt-6', effort: 'high' }, idempotencyKey: randomUUID(),
    })
    await store.startTurn(turn.id)
    await store.setTurnProviderRef(turn.id, 'codex-turn-1')
    const proposal = await store.recordEvent(session.id, turn.id, {
      type: 'plan_proposal', itemId: 'plan-1', providerTurnId: 'codex-turn-1', text: '1. Change code\n2. Test it',
    })
    await store.recordEvent(session.id, turn.id, { type: 'turn_completed', stopReason: 'completed' })
    return { session, turn, proposal }
  }

  it('survives reload and atomically queues one Default turn for two clients', async () => {
    const { session, proposal } = await completedPlan()
    const before = await store.snapshot(session.id)
    expect(before.events.find((event) => event.id === proposal.id)?.event).toMatchObject({
      type: 'plan_proposal', text: '1. Change code\n2. Test it',
    })
    expect(codexPlanHandoffState(before.session, before.turns, before.events, proposal)).toBe('actionable')

    const [first, second] = await Promise.all([
      store.acceptCodexPlan(session.id, 'plan-1', 'Implement the plan'),
      store.acceptCodexPlan(session.id, 'plan-1', 'Implement the plan'),
    ])
    expect([first.inserted, second.inserted].sort()).toEqual([false, true])
    expect(first.turn.id).toBe(second.turn.id)
    const after = await store.snapshot(session.id)
    expect(after.turns).toHaveLength(2)
    expect(after.turns[1]).toMatchObject({
      source: 'interactive', status: 'queued',
      effectivePolicy: { mode: 'default', model: 'gpt-6', effort: 'high', acceptedPlanItemId: 'plan-1' },
    })
    expect(after.session.config).toMatchObject({ draftSetting: 'keep', configOptions: [
      { id: 'mode', currentValue: 'default' }, { id: 'model', currentValue: 'gpt-6' },
      { id: 'reasoning', currentValue: 'high' },
    ] })
    expect(codexPlanHandoffState(after.session, after.turns, after.events, proposal)).toBe('handled')
  })

  it('rejects a stale proposal without switching out of Plan', async () => {
    const { session } = await completedPlan()
    await store.enqueueTurn(session.id, {
      source: 'interactive', input: [{ type: 'text', text: 'Revise the plan' }],
      effectivePolicy: { mode: 'plan' }, idempotencyKey: randomUUID(),
    })
    await expect(store.acceptCodexPlan(session.id, 'plan-1', 'Implement')).rejects.toThrow('no longer available')
    const after = await store.snapshot(session.id)
    expect(after.turns).toHaveLength(2)
    expect((after.session.config.configOptions as Array<{ currentValue: string }>)[0]?.currentValue).toBe('plan')
  })
})
