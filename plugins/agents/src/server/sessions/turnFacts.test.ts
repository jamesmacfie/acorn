import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentNormalizedEvent, AgentToolCall } from '../../contract/wire.ts'
import claudeCapture from '../drivers/__fixtures__/claudeSubagentWire.json' with { type: 'json' }
import codexCapture from '../drivers/__fixtures__/codexSubagentWire.json' with { type: 'json' }
import { normalizeAcpUpdate } from '../drivers/acpNormalizer'
import { CodexChildRouter } from '../drivers/codexChildRouting'
import { normalizeCodexNotification } from '../drivers/codexNormalizer'
import type { JsonRpcNotification } from '../drivers/jsonRpcProcess'
import { computeTurnFacts, TURN_FACTS_VERSION, type TurnFactsInput } from './turnFacts'

const STARTED = 1_000_000

const input = (events: AgentNormalizedEvent[], overrides: Partial<TurnFactsInput> = {}): TurnFactsInput => ({
  turn: {
    id: 'turn',
    sessionId: 'session',
    ordinal: 1,
    source: 'interactive',
    status: 'completed',
    startedAt: STARTED,
    completedAt: STARTED + 60_000,
    effectivePolicyJson: JSON.stringify({ model: 'claude-fable-5-1' }),
  },
  taskId: 'task',
  projectId: 'project',
  provider: 'claude',
  // One event a second, from a second after the turn started.
  events: events.map((event, index) => ({ seq: index + 1, createdAt: STARTED + (index + 1) * 1000, event })),
  requests: [],
  usageBefore: null,
  ...overrides,
})

const facts = (events: AgentNormalizedEvent[], overrides: Partial<TurnFactsInput> = {}) => {
  const row = computeTurnFacts(input(events, overrides))
  if (!row) throw new Error('expected a facts row')
  return row
}

const call = (id: string, tool: Partial<AgentToolCall> = {}): AgentNormalizedEvent => ({
  type: 'tool',
  tool: { id, title: 'Bash', kind: 'execute', input: `{"command":"${id}"}`, status: 'completed', ...tool },
})

describe('computeTurnFacts', () => {
  it('counts a Claude fan-out, its subagents and their calls included', () => {
    const events = (claudeCapture.updates as SessionUpdate[]).flatMap((update) =>
      normalizeAcpUpdate(update, 'Claude Code'),
    )
    const toolIds = new Set(events.flatMap((event) => (event.type === 'tool' ? [event.tool.id] : [])))
    const row = facts(events)

    expect(row.toolCalls).toBe(toolIds.size)
    // The two spawning calls and the seven or so their subagents made.
    expect(row.toolCalls).toBeGreaterThanOrEqual(8)
    expect(row.subagents).toBe(2)
    expect(row.peakContextUsed).toBe(
      Math.max(...events.flatMap((event) => (event.type === 'usage' ? [event.usage.contextUsed ?? 0] : []))),
    )
    expect(row.contextSize).toBe(1_000_000)
    expect(row.firstOutputMs).not.toBeNull()
    expect(row).toMatchObject({
      turnId: 'turn',
      taskId: 'task',
      projectId: 'project',
      model: 'claude-fable-5-1',
      activeMs: 60_000,
      firstSeq: 1,
      version: TURN_FACTS_VERSION,
    })
  })

  it("counts Codex's tokens from the session's total before the turn", () => {
    const router = new CodexChildRouter()
    router.setRootThread(codexCapture.rootThreadId)
    const first = (codexCapture.notifications as JsonRpcNotification[]).flatMap((notification) => {
      const routed = router.route(notification)
      return routed.to === 'parent' ? normalizeCodexNotification(notification) : routed.events
    })
    const usage = first.flatMap((event) => (event.type === 'usage' ? [event.usage] : []))
    const total = usage.at(-1)!
    expect(facts(first, { provider: 'codex' })).toMatchObject({
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      cacheReadTokens: total.cachedInputTokens,
      reportedCostUsd: null,
      subagents: 2,
    })

    // The second turn reports the session's totals too, so only what it added is its own.
    const second: AgentNormalizedEvent = {
      type: 'usage',
      usage: { ...total, inputTokens: total.inputTokens! + 1_000, outputTokens: total.outputTokens! + 10 },
    }
    expect(facts([second], { provider: 'codex', usageBefore: total })).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 10,
      cacheReadTokens: 0,
    })
  })

  it("counts a harness's reported cost from the session's total before the turn", () => {
    const usage = (amount: number): AgentNormalizedEvent => ({
      type: 'usage',
      usage: { contextUsed: 5_000, contextSize: 200_000, cost: { amount, currency: 'USD' } },
    })
    const row = facts([usage(0.5), { type: 'usage', usage: { contextUsed: 9_000 } }, usage(0.75)], {
      usageBefore: { cost: { amount: 0.25, currency: 'USD' } },
    })
    expect(row.reportedCostUsd).toBeCloseTo(0.5)
    expect(row).toMatchObject({ peakContextUsed: 9_000, contextSize: 200_000 })
  })

  it('leaves usage empty for a turn that reported none', () => {
    expect(facts([{ type: 'assistant_message', text: 'Done.' }])).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reportedCostUsd: null,
      peakContextUsed: null,
      contextSize: null,
      firstOutputMs: 1000,
    })
  })

  it('folds a call reported over several events into one, and reads its final status', () => {
    const row = facts([
      call('a', { status: 'running', input: undefined }),
      call('a', { status: undefined }),
      call('a', { status: 'failed' }),
    ])
    expect(row).toMatchObject({ toolCalls: 1, toolFailures: 1, longestFailureRun: 1, failureRunSeq: 1 })
  })

  it('ends a failure run at a success, and counts a nonzero exit code as a failure', () => {
    const row = facts([
      call('a', { status: 'failed' }),
      call('b', { exitCode: 1 }),
      call('c'),
      call('d', { status: 'failed' }),
      call('e', { status: 'failed' }),
      call('f', { status: 'failed' }),
      call('g', { exitCode: 0 }),
    ])
    expect(row).toMatchObject({ toolCalls: 7, toolFailures: 5, longestFailureRun: 3, failureRunSeq: 4 })
  })

  it('counts repeats from the third identical call in a run', () => {
    const same = { input: '{"command":"pnpm test"}', status: 'failed' as const }
    const three = facts([call('a', same), call('b', same), call('c', same)])
    // Three identical failing commands count one.
    expect(three).toMatchObject({ repeatedCalls: 1, repeatRunSeq: 1, toolFailures: 3, longestFailureRun: 3 })

    const runs = facts([
      call('a', same),
      call('b', same),
      call('c'),
      call('d', same),
      call('e', same),
      call('f', same),
      call('g', same),
    ])
    expect(runs).toMatchObject({ repeatedCalls: 2, repeatRunSeq: 4 })
    expect(facts([call('a', same), call('b', same)])).toMatchObject({ repeatedCalls: 0, repeatRunSeq: null })
  })

  it('keeps each subagent its own run, because their calls interleave', () => {
    const same = { input: '{"command":"ls"}' }
    const row = facts([
      call('a', { ...same, subagentId: 'one' }),
      call('b', { input: '{"command":"pwd"}', subagentId: 'two' }),
      call('c', { ...same, subagentId: 'one' }),
      call('d', { input: '{"command":"pwd"}', subagentId: 'two' }),
      call('e', { ...same, subagentId: 'one' }),
    ])
    expect(row).toMatchObject({ toolCalls: 5, repeatedCalls: 1, repeatRunSeq: 1 })
  })

  it('counts changed files, and a file rewritten by three edits or more', () => {
    const change = (path: string, changeId?: string): AgentNormalizedEvent => ({
      type: 'file_change',
      path,
      patch: '@@',
      ...(changeId ? { changeId } : {}),
    })
    const row = facts([
      change('a.ts', 'edit-1'),
      change('a.ts', 'edit-1'),
      change('a.ts', 'edit-2'),
      change('b.ts', 'edit-3'),
      change('b.ts', 'edit-4'),
      change('b.ts', 'edit-5'),
      change('c.ts'),
      change('c.ts'),
      { type: 'file_change', patch: 'diff --git' },
    ])
    expect(row).toMatchObject({ filesChanged: 3, filesRewritten: 1 })
  })

  it("sums the time the turn waited on the person's answers, and counts a blocked request as none", () => {
    const row = facts([], {
      requests: [
        { kind: 'permission', createdAt: STARTED + 1_000, resolvedAt: STARTED + 11_000, blocked: false },
        { kind: 'question', createdAt: STARTED + 20_000, resolvedAt: STARTED + 25_000, blocked: false },
        // Expired unanswered: it waited until the turn ended.
        { kind: 'permission', createdAt: STARTED + 50_000, resolvedAt: null, blocked: false },
        { kind: 'permission', createdAt: STARTED + 30_000, resolvedAt: STARTED + 30_000, blocked: true },
        { kind: 'elicitation', createdAt: STARTED + 30_000, resolvedAt: STARTED + 40_000, blocked: false },
      ],
    })
    expect(row).toMatchObject({ approvals: 3, approvalWaitMs: 25_000, firstSeq: null, firstOutputMs: null })
  })

  it('writes nothing for a turn that is running, never started, or joined another', () => {
    const turn = input([]).turn
    expect(computeTurnFacts(input([], { turn: { ...turn, status: 'active', completedAt: null } }))).toBeNull()
    expect(computeTurnFacts(input([], { turn: { ...turn, status: 'cancelled', startedAt: null } }))).toBeNull()
    expect(computeTurnFacts(input([], { turn: { ...turn, status: 'steered' } }))).toBeNull()
  })
})
