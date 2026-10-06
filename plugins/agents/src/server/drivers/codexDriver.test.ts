import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentNormalizedEvent, AgentSession, AgentTurn } from '../../contract/wire.ts'
import type { AgentDriverEvent, AgentDriverMcpServer } from './types'
import type { MeasureAgentStartup } from './startupTelemetry'
import { sessionStartupTelemetry } from '../sessions/startupTelemetry'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'

const wire = vi.hoisted(() => ({
  modelsWait: undefined as Promise<void> | undefined,
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  responses: [] as Array<{ id: string | number; result: unknown }>,
  modeResponse: {
    data: [
      { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' },
      { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
    ],
  } as unknown,
  onNotification: undefined as undefined | ((notification: {
    method: string
    params: Record<string, unknown>
  }) => void),
  onRequest: undefined as undefined | ((request: {
    id: string | number
    method: string
    params: Record<string, unknown>
  }) => void),
}))

vi.mock('../usage/processRunner', () => ({
  resolveUsageCommand: () => '/tmp/codex-test',
  usageProcessEnv: () => ({}),
}))
vi.mock('./authProbe', () => ({ probeCodexAuthentication: async () => true, probeExecutableVersion: async () => 'codex-cli test' }))
vi.mock('./jsonRpcProcess', () => ({
  JsonRpcProcess: class {
    closed = false

    constructor(options: {
      onNotification?(notification: { method: string; params: Record<string, unknown> }): void
      onRequest?(request: { id: string | number; method: string; params: Record<string, unknown> }): void
    }) {
      wire.onNotification = options.onNotification
      wire.onRequest = options.onRequest
    }

    async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      wire.requests.push({ method, params })
      if (method === 'thread/start' || method === 'thread/resume') {
        return {
          thread: { id: 'thread-1' },
          model: 'gpt-codex',
          reasoningEffort: 'high',
          activePermissionProfile: null,
        }
      }
      if (method === 'model/list') {
        await wire.modelsWait
        return {
          data: [{
            id: 'gpt-codex',
            displayName: 'Codex',
            isDefault: true,
            defaultReasoningEffort: 'high',
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium' },
              { reasoningEffort: 'high' },
            ],
          }],
        }
      }
      if (method === 'permissionProfile/list' || method === 'skills/list') return { data: [] }
      if (method === 'collaborationMode/list') {
        if (wire.modeResponse instanceof Error) throw wire.modeResponse
        return wire.modeResponse
      }
      if (method === 'turn/start') return { turn: { id: 'turn-provider-1' } }
      return {}
    }

    notify(): void {}
    respond(id: string | number, result: unknown): void {
      wire.responses.push({ id, result })
    }
    respondError(): void {}
    async stop(): Promise<void> {
      this.closed = true
    }
  },
}))

const session = (mode: string | null = null, resumed = false): AgentSession => ({
  id: 'session-1',
  taskId: 'task-1',
  providerId: 'codex',
  profileId: 'codex',
  kind: 'interactive',
  driverKind: 'codex-app-server',
  driverVersion: 'test',
  providerSessionRef: resumed ? 'thread-1' : null,
  controller: 'acorn',
  runtimeState: 'creating',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'Codex',
  model: null,
  config: mode ? {
    configOptions: [{
      id: 'mode',
      label: 'Mode',
      category: 'mode',
      currentValue: mode,
      values: [{ value: 'default', label: 'Default' }, { value: 'plan', label: 'Plan' }],
    }],
  } : {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
})

const turn = (mode: string): AgentTurn => ({
  id: 'turn-1',
  sessionId: 'session-1',
  ordinal: 1,
  source: 'interactive',
  status: 'active',
  input: [{ type: 'text', text: 'Hello' }],
  effectivePolicy: { mode, model: 'gpt-codex', effort: 'high' },
  providerTurnRef: null,
  stopReason: null,
  usage: null,
  error: null,
  attempt: 1,
  createdAt: 0,
  startedAt: 0,
  completedAt: null,
})

async function start(
  mode: string | null = null,
  resumed = false,
  config: Record<string, unknown> = {},
  mcpServers: readonly AgentDriverMcpServer[] = [],
  measureStartup?: MeasureAgentStartup,
) {
  const events: AgentNormalizedEvent[] = []
  const driverEvents: AgentDriverEvent[] = []
  const { CodexAgentDriver } = await import('./codexDriver')
  const base = session(mode, resumed)
  const handle = await new CodexAgentDriver().start({
    session: { ...base, config: { ...base.config, ...config } },
    cwd: '/tmp',
    env: {},
    mcpServers,
    noProviderExecutionHistory: false,
    measureStartup,
    onEvent: (event) => {
      driverEvents.push(event)
      if (event.type !== 'generated_artifact') events.push(event)
    },
    onClosed: () => {},
  })
  return { driverEvents, events, handle }
}

const requestIds = (events: AgentNormalizedEvent[]): string[] =>
  events.flatMap((event) => event.type === 'request' ? [event.requestId] : [])

describe('Codex collaboration modes', () => {
  beforeEach(() => {
    wire.modelsWait = undefined
    wire.requests.length = 0
    wire.responses.length = 0
    wire.modeResponse = {
      data: [
        { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' },
        { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
      ],
    }
    wire.onRequest = undefined
    wire.onNotification = undefined
  })

  it('separates a slow metadata request from initialization and records an optional failure', async () => {
    const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const startup = sessionStartupTelemetry(ctx.telemetry, session(), false, new AbortController().signal)!
    let release!: () => void
    wire.modelsWait = new Promise<void>((resolve) => { release = resolve })
    wire.modeResponse = new Error('private provider payload')
    const pending = startup.provider((measure) => start(null, false, {}, [], measure))
    const phases = () => ctx.recorded.filter((record) => record.kind === 'span' && record.name === 'agent.session.phase')
    try {
      await vi.waitFor(() => expect(phases().some((record) => record.attrs.phase === 'provider.modes')).toBe(true))
      expect(phases().some((record) => record.attrs.phase === 'provider.initialize')).toBe(true)
      expect(phases().some((record) => record.attrs.phase === 'provider.models')).toBe(false)
      release()
      const { handle } = await pending
      startup.end('ok')
      expect(handle.ready).toBe(true)
      const provider = ctx.recorded.find((record) => record.kind === 'span' && record.name === 'agent.session')!
      expect(phases().every((record) => record.kind === 'span' && provider.kind === 'span' && record.traceId === provider.traceId && record.parentSpanId === provider.spanId)).toBe(true)
      expect(phases().find((record) => record.attrs.phase === 'provider.modes')).toMatchObject({ status: 'error', attrs: { outcome: 'error' } })
      expect(phases().find((record) => record.attrs.phase === 'provider.models')).toMatchObject({ status: 'ok' })
      expect(JSON.stringify(ctx.recorded)).not.toContain('private provider payload')
      await handle.stop()
    } finally {
      release()
      await pending.then(({ handle }) => handle.stop()).catch(() => undefined)
      ctx.cleanup()
    }
  })

  // The same text on start and on resume, from the snapshot the session was created with.
  it('sends identical custom instructions and standing memory on thread start and resume', async () => {
    const customAgent = { id: 'a1', name: 'Bug reviewer', instructions: 'Review for correctness only.' }
    await (await start(null, false, { customAgent, standingContext: 'Stored memory.' })).handle.stop()
    expect(wire.requests.find((request) => request.method === 'thread/start')?.params)
      .toMatchObject({ developerInstructions: 'Review for correctness only.\n\nStored memory.' })
    await (await start(null, true, { customAgent, standingContext: 'Stored memory.' })).handle.stop()
    expect(wire.requests.find((request) => request.method === 'thread/resume')?.params)
      .toMatchObject({ developerInstructions: 'Review for correctness only.\n\nStored memory.' })
    wire.requests.length = 0
    await (await start()).handle.stop()
    expect(wire.requests.find((request) => request.method === 'thread/start')?.params).not.toHaveProperty('developerInstructions')
  })

  it.each([false, true])('passes explicit MCP credentials for a custom agent with resumed=%s', async (resumed) => {
    const { handle } = await start(null, resumed, {
      customAgent: { id: 'a1', name: 'Phase delegator', instructions: 'Use Acorn delegation tools.' },
    }, [{
      transport: 'stdio',
      name: 'acorn-dev',
      command: '/opt/acorn/node',
      args: ['/opt/acorn/mcp.js'],
      env: { ACORN_API_TOKEN: 'signed', ACORN_TASK_ID: 'task-1', ACORN_SESSION_ID: 'session-1' },
    }])
    await handle.stop()

    expect(wire.requests.find((request) => request.method === (resumed ? 'thread/resume' : 'thread/start'))?.params)
      .toMatchObject({
        developerInstructions: 'Use Acorn delegation tools.',
        config: { mcp_servers: { 'acorn-dev': {
          command: '/opt/acorn/node',
          args: ['/opt/acorn/mcp.js'],
          env: { ACORN_API_TOKEN: 'signed', ACORN_TASK_ID: 'task-1', ACORN_SESSION_ID: 'session-1' },
        } } },
      })
  })

  it('advertises the modes provider capability', async () => {
    const { CodexAgentDriver } = await import('./codexDriver')
    expect((await new CodexAgentDriver().probe()).capabilities).toEqual(expect.arrayContaining([
      'modes',
      'generated_artifacts',
    ]))
  })

  it('emits image generation output through the generated-artifact seam', async () => {
    const { driverEvents } = await start()
    wire.onNotification?.({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: {
          type: 'imageGeneration',
          id: 'image-1',
          status: 'completed',
          result: 'iVBORw0KGgo=',
        },
      },
    })
    await Promise.resolve()

    expect(driverEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'generated_artifact',
        kind: 'file',
        title: 'Generated image.png',
        mediaType: 'image/png',
      }),
    ]))
  })

  it('advertises modes and sends each selected preset with complete settings', async () => {
    const { events, handle } = await start()
    const metadata = events.find((event) => event.type === 'session_metadata')
    expect(metadata?.type === 'session_metadata'
      ? metadata.configOptions?.find((option) => option.id === 'mode')
      : null).toMatchObject({
      currentValue: 'default',
      values: [{ value: 'default', label: 'Default' }, { value: 'plan', label: 'Plan' }],
    })

    await handle.sendTurn({ turn: turn('plan'), input: turn('plan').input, attachments: {} })
    expect(wire.requests.findLast((request) => request.method === 'turn/start')?.params).toMatchObject({
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-codex', reasoning_effort: 'medium', developer_instructions: null },
      },
    })
    expect(wire.requests.findLast((request) => request.method === 'turn/start')?.params).not.toHaveProperty('model')
    expect(wire.requests.findLast((request) => request.method === 'turn/start')?.params).not.toHaveProperty('effort')

    const defaultSession = await start()
    await defaultSession.handle.setConfig?.('mode', 'default')
    await defaultSession.handle.sendTurn({ turn: turn('default'), input: turn('default').input, attachments: {} })
    expect(wire.requests.findLast((request) => request.method === 'turn/start')?.params).toMatchObject({
      collaborationMode: {
        mode: 'default',
        settings: { model: 'gpt-codex', reasoning_effort: 'high', developer_instructions: null },
      },
    })
  })

  it('omits the picker when mode discovery is unsupported', async () => {
    wire.modeResponse = new Error('Method not found')
    const { events } = await start()
    const metadata = events.find((event) => event.type === 'session_metadata')
    expect(metadata?.type === 'session_metadata'
      ? metadata.configOptions?.some((option) => option.id === 'mode')
      : true).toBe(false)
    expect(events).toContainEqual({ type: 'session_state', state: 'ready' })
  })

  it('preserves a stored Plan selection when resuming', async () => {
    const { events } = await start('plan', true)
    const metadata = events.find((event) => event.type === 'session_metadata')
    expect(metadata?.type === 'session_metadata'
      ? metadata.configOptions?.find((option) => option.id === 'mode')?.currentValue
      : null).toBe('plan')
  })

  it('synchronizes effective settings reported by Codex', async () => {
    const { events } = await start()
    wire.onNotification?.({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-1',
        threadSettings: {
          model: 'gpt-codex',
          effort: 'medium',
          collaborationMode: {
            mode: 'plan',
            settings: { model: 'gpt-codex', reasoning_effort: 'medium', developer_instructions: null },
          },
        },
      },
    })
    await Promise.resolve()

    const metadata = events.findLast((event) => event.type === 'session_metadata')
    expect(metadata?.type === 'session_metadata'
      ? metadata.configOptions?.map((option) => [option.id, option.currentValue])
      : []).toEqual(expect.arrayContaining([
      ['mode', 'plan'],
      ['model', 'gpt-codex'],
      ['reasoning', 'medium'],
    ]))
    expect(events).toContainEqual({ type: 'diagnostic', level: 'info', message: 'Mode changed to Plan' })
  })

  it('completes the request_user_input response on the app-server wire', async () => {
    const { events, handle } = await start('plan')
    wire.onRequest?.({
      id: 42,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{ id: 'scope', header: 'Scope', question: 'Which scope?', options: null }],
      },
    })
    await handle.resolveRequest(requestIds(events)[0]!, { answers: { scope: 'All files' } })
    expect(wire.responses).toEqual([{
      id: 42,
      result: { answers: { scope: { answers: ['All files'] } } },
    }])
  })

  // Captured 2026-10-06: Codex sends the failure as an `error` notification, then again on
  // `turn/completed`, and puts the provider's raw JSON body in the message.
  it('shows a failed turn once, with the provider message, and again on the next turn', async () => {
    const body = JSON.stringify({
      type: 'error',
      error: { message: "model 'gpt-6.1-sol' is not enabled in rustponsesapi", type: 'invalid_request_error' },
      status: 400,
    })
    const fail = async () => {
      const error = { message: body, codexErrorInfo: 'other' }
      wire.onNotification?.({ method: 'error', params: { error, willRetry: false } })
      wire.onNotification?.({ method: 'turn/completed', params: { turn: { id: 'turn-provider-1', status: 'failed', error } } })
      await Promise.resolve()
    }
    const { events, handle } = await start()
    const errors = () => events.filter((event) => event.type === 'error')

    await handle.sendTurn({ turn: turn('default'), input: turn('default').input, attachments: {} })
    await fail()
    expect(errors()).toEqual([{
      type: 'error',
      code: 'other',
      message: "model 'gpt-6.1-sol' is not enabled in rustponsesapi",
      retryable: false,
    }])

    wire.onNotification?.({ method: 'thread/status/changed', params: { status: { type: 'idle' } } })
    await handle.sendTurn({ turn: turn('default'), input: turn('default').input, attachments: {} })
    await fail()
    expect(errors()).toHaveLength(2)
  })

  // Each app-server process numbers its requests from 0, so a resumed session asks a second
  // request 0. Reusing that number would attach the new question to the one already answered.
  it('gives a request Codex numbered again after a restart its own id', async () => {
    const ask = () => wire.onRequest?.({
      id: 0,
      method: 'item/tool/requestUserInput',
      params: { questions: [{ id: 'scope', header: 'Scope', question: 'Which scope?', options: null }] },
    })
    const first = await start('plan')
    ask()
    const second = await start('plan', true)
    ask()
    const [before] = requestIds(first.events)
    const [after] = requestIds(second.events)
    expect(before).not.toBe('0')
    expect(after).not.toBe(before)
    await second.handle.resolveRequest(after!, { answers: { scope: 'All files' } })
    expect(wire.responses).toEqual([{ id: 0, result: { answers: { scope: { answers: ['All files'] } } } }])
  })
})
