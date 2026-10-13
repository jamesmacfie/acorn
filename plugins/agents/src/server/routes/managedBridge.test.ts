// The usage fold, at the seam it happens on, against a real migrated database.
//
// The rule itself is unit-tested beside `foldUsageEvents`. What only a database can answer is
// that the HTTP snapshot a client reads is folded while the ledger every other reader goes through is
// not: pricing, the usage settings page and workflow execution all count the rows.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { AgentStore } from '../sessions/store'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { managedAgentsBridge } from './managedBridge'

const PROVIDER: AgentProviderDescriptor = {
  id: 'fake',
  profileId: 'fake',
  label: 'Fake',
  driverKind: 'acp',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

describe('the snapshot a client reads', () => {
  let ctx: TestNodeContext
  let store: AgentStore

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    store = new AgentStore(ctx.storage.open(), ctx.core)
  })
  afterEach(() => ctx.cleanup())

  // Only `store` is reached on this path, so the bridge is built over it rather than over a whole
  // runtime with a driver, a registry and a temporary worktree behind it.
  const bridge = () => managedAgentsBridge({ store } as unknown as ManagedAgentRuntime)

  it('carries one usage row a turn, and the ledger still holds every one', async () => {
    const session = await store.createSession(
      {
        taskId: randomUUID(),
        providerId: 'fake',
        profileId: 'fake',
        kind: 'interactive',
        config: {},
      },
      PROVIDER,
    )
    const { turn } = await store.enqueueTurn(session.id, {
      source: 'interactive',
      input: [{ type: 'text', text: 'go' }],
      effectivePolicy: {},
      idempotencyKey: 'k1',
    })
    await store.recordEvent(session.id, turn.id, { type: 'user_message', text: 'go' })
    // Dozens of usage updates in one turn is ordinary for a real session.
    for (let at = 1; at <= 58; at++) {
      await store.recordEvent(session.id, turn.id, { type: 'usage', usage: { contextUsed: at * 100, inputTokens: at } })
    }

    const projected = await bridge().snapshot(session.id)
    const usage = projected.events.filter((event) => event.event.type === 'usage')
    expect(usage).toHaveLength(1)
    expect(usage[0].event).toEqual({ type: 'usage', usage: { contextUsed: 5_800, inputTokens: 58 } })
    // Everything else survives untouched, in seq order.
    expect(projected.events.filter((event) => event.event.type === 'user_message')).toHaveLength(1)
    const seqs = projected.events.map((event) => event.seq)
    expect(seqs.every((seq, at) => at === 0 || seq > seqs[at - 1])).toBe(true)

    const ledger = await store.exportSnapshot(session.id)
    expect(ledger.events.filter((event) => event.event.type === 'usage')).toHaveLength(58)
    // The store's own read is unfolded too: workflow execution builds a turn's usage capture from it.
    const raw = await store.snapshot(session.id)
    expect(raw.events.filter((event) => event.event.type === 'usage')).toHaveLength(58)
    const page = await store.eventPage(session.id)
    expect(page.events.filter((event) => event.event.type === 'usage')).toHaveLength(58)
  })

  it('folds a tool call only for a reader that asks, and pages on from where the fold reached', async () => {
    const session = await store.createSession(
      {
        taskId: randomUUID(),
        providerId: 'fake',
        profileId: 'fake',
        kind: 'interactive',
        config: {},
      },
      PROVIDER,
    )
    const { turn } = await store.enqueueTurn(session.id, {
      source: 'interactive',
      input: [{ type: 'text', text: 'go' }],
      effectivePolicy: {},
      idempotencyKey: 'k1',
    })
    // A running call under a turn that never started reads back as `unknown` (`commandStatus`).
    await store.startTurn(turn.id)
    await store.recordEvent(session.id, turn.id, { type: 'tool', tool: { id: 'cmd', title: 'ls', status: 'running' } })
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'Listing.' })
    for (let at = 1; at <= 5; at++) {
      await store.recordEvent(session.id, turn.id, {
        type: 'tool',
        tool: { id: 'cmd', title: '', output: `${at}\n`, outputAppend: true },
      })
    }
    await store.recordEvent(session.id, turn.id, { type: 'assistant_message', text: 'Done.' })

    // The ledger holds the call as its opener and its latest state (`LedgerFold`), and a
    // reader that does not ask gets both as stored.
    const tools = (events: { event: { type: string } }[]) => events.filter((event) => event.event.type === 'tool')
    expect(tools((await bridge().snapshot(session.id)).events).map((event) => event.event)).toEqual([
      { type: 'tool', tool: { id: 'cmd', title: 'ls', status: 'running' } },
      { type: 'tool', tool: { id: 'cmd', title: 'ls', status: 'running', output: '1\n2\n3\n4\n5\n' } },
    ])
    expect(tools((await bridge().events(session.id)).events)).toHaveLength(2)

    const [folded] = tools((await bridge().snapshot(session.id, 0, 2_000, true)).events)
    expect(folded.event).toEqual({
      type: 'tool',
      tool: { id: 'cmd', title: 'ls', status: 'running', output: '1\n2\n3\n4\n5\n' },
    })
    // A page of three rows ends on the latest state, which folded into the first, so the next page
    // starts past it.
    const page = await bridge().events(session.id, 0, 3, true)
    expect(page.events).toHaveLength(2)
    expect(page.events[0].foldedThroughSeq).toBe(7)
    expect(page.nextCursor).toBe(7)
    expect((await store.exportSnapshot(session.id)).events).toHaveLength(4)
  })

  it('leaves the search text out of both pages, and keeps it for export', async () => {
    const session = await store.createSession(
      {
        taskId: randomUUID(),
        providerId: 'fake',
        profileId: 'fake',
        kind: 'interactive',
        config: {},
      },
      PROVIDER,
    )
    await store.recordEvent(session.id, null, { type: 'tool', tool: { id: 'cmd', title: 'ls', output: 'README.md' } })

    const reads = [
      await bridge().snapshot(session.id),
      await bridge().snapshot(session.id, 0, 2_000, true),
      await bridge().events(session.id),
      await bridge().events(session.id, 0, 500, true),
    ]
    for (const read of reads) {
      expect(read.events).toHaveLength(1)
      expect(read.events[0]).not.toHaveProperty('searchText')
    }
    expect((await store.exportSnapshot(session.id)).events[0].searchText).toBe('ls README.md')
  })

  it('projects delegation visibility onto the bounded session list', async () => {
    const session = await store.createSession(
      {
        taskId: randomUUID(),
        providerId: 'fake',
        profileId: 'fake',
        kind: 'delegated',
        config: {},
      },
      PROVIDER,
    )
    const projectSessionList = async (page: Awaited<ReturnType<AgentStore['listSessions']>>) => ({
      ...page,
      delegations: [
        {
          sessionId: session.id,
          depth: 1,
          isolation: 'shared' as const,
          owner: { kind: 'managed' as const, parentSessionId: 'parent-1' },
        },
      ],
    })

    const listed = await managedAgentsBridge({ store } as unknown as ManagedAgentRuntime, {
      projectSessionList,
    }).listSessions({ taskId: session.taskId })
    expect(listed.delegations).toEqual([
      {
        sessionId: session.id,
        depth: 1,
        isolation: 'shared',
        owner: { kind: 'managed', parentSessionId: 'parent-1' },
      },
    ])
  })

  // Shaped like a running Claude Code session's config: about 80 advertised slash commands, a few
  // dozen skills, the standing context, and the mode, model and effort pickers.
  const describedValues = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ value: `value-${i}`, label: `Value ${i}`, description: 'x'.repeat(60) }))
  const heavyConfig = () => ({
    account: 'work',
    commands: Array.from({ length: 80 }, (_, i) => ({ name: `command-${i}`, description: 'x'.repeat(330) })),
    skills: Array.from({ length: 30 }, (_, i) => ({ name: `skill-${i}`, description: 'x'.repeat(150) })),
    standingContext: 'x'.repeat(11_000),
    configOptions: [
      { id: 'mode', label: 'Mode', category: 'mode', currentValue: 'value-0', values: describedValues(6) },
      { id: 'model', label: 'Model', category: 'model', currentValue: 'value-1', values: describedValues(14) },
      { id: 'effort', label: 'Effort', category: 'reasoning', currentValue: 'value-2', values: describedValues(5) },
    ],
  })

  it('lists a page of sessions without the detail only an open session reads', async () => {
    const taskId = randomUUID()
    const sessions = []
    for (let i = 0; i < 50; i += 1)
      sessions.push(
        await store.createSession(
          { taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: heavyConfig() },
          PROVIDER,
        ),
      )
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))

    const whole = await store.listSessions({ taskId, limit: 50 })
    const listed = await bridge().listSessions({ taskId, limit: 50 })
    expect(listed.sessions).toHaveLength(50)
    expect(bytes(whole)).toBeGreaterThan(2_000_000)
    expect(bytes(listed)).toBeLessThan(100_000)

    const row = listed.sessions[0]!
    expect(row.listRow).toBe(true)
    expect(row.config).not.toHaveProperty('commands')
    expect(row.config).not.toHaveProperty('skills')
    expect(row.config).not.toHaveProperty('standingContext')
    expect(row.config.account).toBe('work')
    expect(row.config.configOptions).toContainEqual({
      id: 'model',
      label: 'Model',
      category: 'model',
      currentValue: 'value-1',
      values: [{ value: 'value-1', label: 'Value 1', description: 'x'.repeat(60) }],
    })

    const opened = await bridge().snapshot(sessions[0]!.id, 0, 10, false)
    expect(opened.session.listRow).toBeUndefined()
    expect(opened.session.config).toMatchObject({ commands: heavyConfig().commands, skills: heavyConfig().skills })
  })
})

it('answers a session for an unknown provider as a bad request', async () => {
  const runtime = {
    acceptSession: async () => {
      throw new Error('Unknown agent provider: nope')
    },
  } as unknown as ManagedAgentRuntime
  await expect(managedAgentsBridge(runtime).createSession({ providerId: 'nope' } as never)).rejects.toMatchObject({
    status: 400,
    code: 'bad_request',
  })
})

it('answers a secret gate refusal as a conflict that keeps its reason', async () => {
  const { SecretPublicationRefused } = await import('../sessions/secretPublication')
  const report = {
    detectorVersion: 'acorn-secrets/1',
    digest: 'd',
    findings: [{ rule: 'npm-token', confidence: 'high' as const, location: 'markdown export', line: 4, column: 1 }],
    counts: { high: 1, heuristic: 0 },
    truncated: false,
    unscanned: [],
    complete: true,
    limits: [],
  }
  const runtime = {
    exportSession: async () => {
      throw new SecretPublicationRefused({
        decisionId: 'a'.repeat(64),
        operation: 'export',
        reason: 'findings',
        report,
      })
    },
  } as unknown as ManagedAgentRuntime
  await expect(managedAgentsBridge(runtime).exportSession('s1', 'markdown', 'original')).rejects.toMatchObject({
    status: 409,
    code: 'secret_check_blocked',
    message: expect.stringContaining('npm-token at markdown export:4'),
  })
})

it.each(['Agent request resolution is already in progress.', 'That choice was not offered for this request.'])(
  'answers a resolution the request refuses as a conflict: %s',
  async (message) => {
    const runtime = {
      resolveRequest: async () => {
        throw new Error(message)
      },
    } as unknown as ManagedAgentRuntime
    await expect(
      managedAgentsBridge(runtime).resolveRequest('s1', 'r1', { optionId: 'x' }, 'key-12345'),
    ).rejects.toMatchObject({ status: 409, code: 'agent_conflict', message })
  },
)
