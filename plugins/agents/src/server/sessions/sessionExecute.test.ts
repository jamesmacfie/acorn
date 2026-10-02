import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { InternalEnvFactory } from '@acorn/plugin-api/node'
import type { AgentConfigOption, AgentNormalizedEvent, AgentProviderDescriptor } from '../../contract/wire.ts'
import type { StreamEvent } from '@acorn/plugin-api/node'
import type { ToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from '../drivers/types'
import { AgentDriverRegistry } from '../drivers/registry'
import { ManagedAgentRuntime } from './runtime'
import { createSessionExecute } from './sessionExecute'

// A workflow step's turn (docs/workflows.md § Execution model). The step names the provider options
// it wants and they have to be applied to the session, because the Claude driver takes a switch only
// through `setConfig` and never off the turn.

const advertised = (): AgentConfigOption[] => [
  {
    id: 'model',
    label: 'Model',
    category: 'model',
    currentValue: 'sonnet',
    values: [{ value: 'sonnet', label: 'Sonnet 5' }, { value: 'opus', label: 'Opus 5' }],
  },
  {
    id: 'reasoning',
    label: 'Reasoning effort',
    category: 'reasoning',
    currentValue: 'medium',
    values: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
  },
]

// Registered as the profile `agents.sessionExecute` maps to a managed provider, so the whole path
// runs rather than falling through to the caller's headless fallback.
class ConfigDriver implements AgentDriver {
  readonly providerId = 'claude'
  readonly profileId = 'claude-code'
  readonly configSets: Array<[string, string]> = []
  readonly turns: AgentDriverTurnOptions[] = []
  readonly envs: Record<string, string>[] = []
  // What each turn answers, in order. Past the end of the script every turn answers 'Done.'.
  replies: Array<{ text: string; stopReason: string; events?: AgentNormalizedEvent[]; hang?: boolean; afterEvents?: () => void }> = []
  push: (event: AgentNormalizedEvent) => Promise<void> = async () => {}

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Config test',
      driverKind: 'acp',
      driverVersion: 'test-1',
      installed: true,
      authenticated: true,
      statusAuthority: 'protocol',
      capabilities: ['streaming_messages', 'resume'],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: [],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    this.push = async (event) => { await options.onEvent(event) }
    this.envs.push(options.env)
    const providerSessionRef = options.session.providerSessionRef ?? `cfg-${randomUUID()}`
    let active = false
    let current = advertised()
    await options.onEvent({ type: 'session_metadata', providerSessionRef, configOptions: current })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    const driver = this
    return {
      providerSessionRef,
      get ready() {
        return !active
      },
      async sendTurn(turn: AgentDriverTurnOptions) {
        active = true
        driver.turns.push(turn)
        const reply = driver.replies.shift() ?? { text: 'Done.', stopReason: 'end_turn' }
        for (const event of reply.events ?? []) await options.onEvent(event)
        if (reply.text) await options.onEvent({ type: 'assistant_message', text: reply.text })
        reply.afterEvents?.()
        if (reply.hang) return { providerTurnRef: `turn-${turn.turn.id}` }
        await options.onEvent({ type: 'turn_completed', stopReason: reply.stopReason })
        active = false
        return { providerTurnRef: `turn-${turn.turn.id}` }
      },
      async cancel() {
        active = false
      },
      async resolveRequest() {},
      async setConfig(optionId: string, value: string) {
        driver.configSets.push([optionId, value])
        current = current.map((option) => option.id === optionId ? { ...option, currentValue: value } : option)
        return current
      },
      async stop() {},
    }
  }
}

describe('agents.sessionExecute config options', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let driver: ConfigDriver
  let taskId: string
  let mintedClaims: Parameters<InternalEnvFactory>[0][]

  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const worktree = join(ctx.dataDir, 'worktree')
    await mkdir(worktree)
    const at = Date.now()
    const workspaceId = randomUUID()
    taskId = randomUUID()
    await ctx.db.insert(schema.workspaces).values({ id: workspaceId, name: 'W', createdAt: at, updatedAt: at })
    await ctx.db.insert(schema.projects).values({
      id: 'project-cfg',
      name: 'cfg',
      path: worktree,
      workspaceId,
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: null,
      githubOwner: 'acorn',
      githubName: 'cfg',
      githubRepoId: null,
      createdAt: at,
      updatedAt: at,
    })
    await ctx.db.insert(schema.tasks).values({
      id: taskId,
      title: 'Config test',
      origin: 'local',
      projectId: 'project-cfg',
      branch: 'test',
      worktreePath: worktree,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    driver = new ConfigDriver()
    const registry = new AgentDriverRegistry()
    registry.registerNative('claude', () => driver)
    mintedClaims = []
    runtime = new ManagedAgentRuntime({
      db: ctx.storage.open(),
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: (claims) => {
        mintedClaims.push(claims)
        return {}
      },
      secrets: ctx.env.SECRETS,
      currentUserId: () => null,
      registry,
    })
  })

  afterEach(async () => {
    await runtime.stop()
    ctx.cleanup()
  })

  const execute = (configOptions?: Record<string, string>, tools?: ToolCeiling) => createSessionExecute(runtime)({
    taskId,
    profileId: 'claude-code',
    title: 'Workflow: synthesise',
    prompt: 'Write one answer.',
    configOptions,
    tools,
    runId: 'run-1',
    stepId: 'step-1',
  })

  it('applies what the provider advertised, and puts the same request on the turn', async () => {
    const result = await execute({ model: 'opus', reasoning: 'high' })
    expect(result?.status).toBe('ok')
    expect(driver.configSets).toEqual([['model', 'opus'], ['reasoning', 'high']])

    const session = await runtime.store.requireSession(result!.agentSessionId!)
    const options = session.config.configOptions as AgentConfigOption[]
    expect(options.map((option) => [option.id, option.currentValue])).toEqual([['model', 'opus'], ['reasoning', 'high']])

    // Codex reads the model and the effort off the turn, so both drivers see the same request.
    const policy = driver.turns[0]!.turn.effectivePolicy
    expect(policy.model).toBe('opus')
    expect(policy.effort).toBe('high')
  })

  it('mints the managed session token from its persisted tool ceiling', async () => {
    const tools = { allow: ['task_current'], maxRisk: 'read' as const }
    const result = await execute(undefined, tools)
    const session = await runtime.store.requireSession(result!.agentSessionId!)

    expect(session.config.toolCeiling).toEqual(tools)
    expect(mintedClaims).toContainEqual({
      scope: 'task',
      taskId,
      sessionId: session.id,
      toolCeiling: tools,
    })

    // Claude Code starts the acorn MCP server from its own registration, so the server gets only what
    // the provider process inherits, and it lists no tools without a task ID.
    expect(driver.envs[0]).toMatchObject({ ACORN_TASK_ID: taskId, ACORN_SESSION_ID: session.id })

    const patched = await runtime.patchSession(session.id, { config: { toolCeiling: { maxRisk: 'execute' } } })
    expect(patched.config.toolCeiling).toEqual(tools)
    expect(patched.config).toMatchObject({ workflowRunId: 'run-1', workflowStepId: 'step-1' })
    const fork = await runtime.fork(session.id)
    expect(fork.config).toMatchObject({ workflowRunId: 'run-1', workflowStepId: 'step-1', toolCeiling: tools })
  })

  it('drops a value the provider does not offer and says so in the transcript', async () => {
    const result = await execute({ model: 'gpt-9', reasoning: 'high' })
    expect(result?.status).toBe('ok')
    expect(driver.configSets).toEqual([['reasoning', 'high']])

    const snapshot = await runtime.store.snapshot(result!.agentSessionId!, 0)
    const warnings = snapshot.events.flatMap((record) =>
      record.event.type === 'diagnostic' && record.event.level === 'warning' ? [record.event.message] : [])
    expect(warnings.join('\n')).toContain('model = gpt-9')
  })

  it('leaves the session alone when the step asks for nothing', async () => {
    const result = await execute()
    expect(result?.status).toBe('ok')
    expect(driver.configSets).toEqual([])
  })

  // The transcript draws the prompt and folds each context part, so the step's own prompt is all the
  // reader sees of the turn unless they open a part.
  it('sends the context as parts of their own, and inlines them past the context cap', async () => {
    const withContext = (content: string) => createSessionExecute(runtime)({
      taskId,
      profileId: 'claude-code',
      title: 'Workflow: synthesise',
      prompt: 'Write one answer.',
      context: [{ label: 'Output of get-diff', source: 'workflow.upstream', content }],
      runId: 'run-1',
      stepId: `step-${randomUUID()}`,
    })
    await withContext('diff --git a/x b/x')
    expect(driver.turns[0]!.input.map((part) => part.type)).toEqual(['text', 'context'])
    expect(driver.turns[0]!.input[1]).toMatchObject({ label: 'Output of get-diff', content: 'diff --git a/x b/x' })

    await withContext('x'.repeat(600 * 1024))
    const [only, ...rest] = driver.turns[1]!.input
    expect(rest).toEqual([])
    expect(only?.type === 'text' && only.text).toContain('<acorn-context source="workflow.upstream" label="Output of get-diff">')
  })

  describe('a turn that ends without what the step needs', () => {
    const answerSchema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] }
    const executeWithSchema = () => createSessionExecute(runtime)({
      taskId,
      profileId: 'claude-code',
      title: 'Workflow: synthesise',
      prompt: 'Write one answer.',
      schema: answerSchema,
      runId: 'run-1',
      stepId: 'step-1',
    })
    const promptOf = (turn: AgentDriverTurnOptions) => turn.input.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')

    it('is told to carry on, and the step takes the result the next turn returns', async () => {
      driver.replies = [
        { text: 'I have read the files. Next I will write the answer.', stopReason: 'end_turn' },
        { text: '```json\n{"answer":"42"}\n```', stopReason: 'end_turn' },
      ]
      const outcome = await executeWithSchema()
      expect(outcome?.status).toBe('ok')
      expect(outcome?.capture.structuredOutput).toEqual({ answer: '42' })
      expect(driver.turns).toHaveLength(2)
      expect(promptOf(driver.turns[1]!)).toContain('fenced `json` result block')
      expect(driver.turns[1]!.turn.effectivePolicy.continuationOf).toBe(driver.turns[0]!.turn.id)
    })

    it('is told twice at most, then the step reports the malformed result', async () => {
      driver.replies = [1, 2, 3, 4].map(() => ({ text: 'Still working.', stopReason: 'end_turn' }))
      const outcome = await executeWithSchema()
      expect(outcome?.status).toBe('malformed')
      expect(outcome?.capture.result).toBe('Still working.')
      expect(driver.turns).toHaveLength(3)
    })

    it('fails the step on a refusal without asking again', async () => {
      driver.replies = [{ text: '', stopReason: 'refusal' }]
      const outcome = await executeWithSchema()
      expect(outcome?.status).toBe('error')
      expect(outcome?.stderrTail).toContain('The model declined this request.')
      expect(driver.turns).toHaveLength(1)
    })
  })
  describe('complete workflow capture', () => {
    const normalized = (event: StreamEvent): AgentNormalizedEvent | undefined =>
      event.type === 'managed-agent' ? event.event as AgentNormalizedEvent : undefined
    const run = (extra: Partial<Parameters<ReturnType<typeof createSessionExecute>>[0]> = {}) => createSessionExecute(runtime)({
      taskId, profileId: 'claude-code', title: 'Capture', prompt: 'Answer.', timeoutMs: 5_000, ...extra,
    })
    const progress = (count: number): AgentNormalizedEvent[] => Array.from({ length: count }, (_, n) => ({
      type: 'reasoning', text: `reason ${n}`, messageId: `reason-${n}`,
    }))

    it.each([501, 2_001])('captures results beyond %i events and parses a JSON token across pages', async (count) => {
      const expected = '```json\n{"answer":"' + 'x'.repeat(300_000) + 'token"}\n```'
      driver.replies = [{ text: '', stopReason: 'end_turn', events: [
        ...progress(498),
        { type: 'assistant_message', text: expected.slice(0, -10), append: true, messageId: 'answer' },
        { type: 'diagnostic', level: 'info', message: 'page boundary' },
        { type: 'assistant_message', text: expected.slice(-10), append: true, messageId: 'answer' },
        ...progress(count - 501),
      ] }]
      const streamed: StreamEvent[] = []
      // Force the entire accepted stream into the enqueue/turn-id gap.
      const enqueue = runtime.enqueueTurn.bind(runtime)
      vi.spyOn(runtime, 'enqueueTurn').mockImplementation(async (...args) => {
        const turn = await enqueue(...args)
        await vi.waitFor(async () => expect((await runtime.store.turn(turn.id))?.status).toBe('completed'), { timeout: 5_000 })
        return turn
      })
      const result = await run({ onEvent: (event) => streamed.push(event),
        schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } })
      expect(result?.status).toBe('ok')
      expect(result?.capture.result).toBe(expected)
      expect(result?.capture.structuredOutput).toEqual({ answer: 'x'.repeat(300_000) + 'token' })
      const captured = result!.capture.events.filter((event) => event.type === 'managed-agent')
      const live = streamed.filter((event) => event.type === 'managed-agent')
      expect(captured.length).toBeGreaterThan(count)
      expect(live.map((event) => event.sequence)).toEqual(captured.map((event) => event.sequence))
      expect(new Set(live.map((event) => event.sequence)).size).toBe(live.length)
      const ordinary = await runtime.store.snapshot(result!.agentSessionId!)
      expect(ordinary.events).toHaveLength(500)
      vi.restoreAllMocks()
    })

    it.each(['cancelled', 'timeout', 'error', 'interrupted'] as const)('retains the full response and tool events for %s', async (status) => {
      const controller = new AbortController()
      driver.replies = [{ text: '', stopReason: 'end_turn', hang: true, events: [
        ...progress(501), { type: 'tool', tool: { id: 'tool', title: 'Read', status: 'completed', output: 'exact tool output' } },
        { type: 'assistant_message', text: 'exact partial response' },
        ...(['error', 'interrupted'].includes(status) ? [{ type: 'error', code: 'failed', message: 'provider failed', retryable: status === 'interrupted' } as const] : []),
      ] }]
      const result = await run({ signal: controller.signal, timeoutMs: status === 'timeout' ? 200 : 5_000,
        onEvent: (event) => { if (status === 'cancelled' && normalized(event)?.type === 'assistant_message') controller.abort() },
      })
      expect(result?.status).toBe(status === 'interrupted' ? 'error' : status)
      expect(result?.capture.result).toBe('exact partial response')
      expect(result?.capture.events.some((event) => {
        const value = normalized(event)
        return value?.type === 'tool' && value.tool.output === 'exact tool output'
      })).toBe(true)
    })

    it('keeps both target turns complete and excludes unrelated session history', async () => {
      driver.replies = [{ text: 'unrelated', stopReason: 'end_turn' }]
      const previous = await run()
      driver.replies = [
        { text: 'malformed', stopReason: 'end_turn', events: progress(501) },
        { text: '```json\n{"answer":"complete"}\n```', stopReason: 'end_turn', events: progress(2_001) },
      ]
      const result = await run({ managedSessionId: previous!.agentSessionId!, schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } } })
      expect(result?.status).toBe('ok')
      expect(result?.capture.structuredOutput).toEqual({ answer: 'complete' })
      expect(result?.capture.events.length).toBeGreaterThan(2_500)
      expect(result?.capture.events.some((event) => {
        const value = normalized(event)
        return value?.type === 'assistant_message' && value.text === 'unrelated'
      })).toBe(false)
    })

    it('flushes accepted append deltas before cancellation capture without waiting for the buffer timer', async () => {
      const controller = new AbortController()
      driver.replies = [{ text: '', stopReason: 'end_turn', hang: true,
        events: [{ type: 'assistant_message', text: 'accepted buffered text', append: true }],
        afterEvents: () => controller.abort(),
      }]
      const result = await run({ signal: controller.signal })
      expect(result?.status).toBe('cancelled')
      expect(result?.capture.result).toBe('accepted buffered text')
    })

    it('returns without waiting for usage and retains late usage without changing the capture', async () => {
      const result = await run()
      expect(result?.status).toBe('ok')
      expect(result?.capture.usage).toBeUndefined()
      await driver.push({ type: 'usage', usage: { inputTokens: 12, outputTokens: 34 } })
      const late = (await runtime.store.eventPage(result!.agentSessionId!)).events.at(-1)!
      expect(late.event).toEqual({ type: 'usage', usage: { inputTokens: 12, outputTokens: 34 } })
      expect(late.turnId).toBeNull()
      await runtime.store.recordEvent(result!.agentSessionId!, driver.turns[0]!.turn.id, late.event)
      expect((await runtime.store.turn(driver.turns[0]!.turn.id))?.usage).toMatchObject({ inputTokens: 12, outputTokens: 34 })
      expect(result?.capture.usage).toBeUndefined()
    })
  })

})
