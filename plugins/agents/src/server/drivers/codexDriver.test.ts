import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentNormalizedEvent, AgentSession, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import type { AgentDriverEvent } from './types'

const wire = vi.hoisted(() => ({
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

vi.mock('node:child_process', () => ({
  execFile: (
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, result: { stdout: string; stderr: string }) => void,
  ) => callback(null, { stdout: 'codex-cli test', stderr: '' }),
}))
vi.mock('../usage/processRunner', () => ({
  resolveUsageCommand: () => '/tmp/codex-test',
  usageProcessEnv: () => ({}),
}))
vi.mock('./authProbe', () => ({ probeCodexAuthentication: async () => true }))
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

async function start(mode: string | null = null, resumed = false) {
  const events: AgentNormalizedEvent[] = []
  const driverEvents: AgentDriverEvent[] = []
  const { CodexAgentDriver } = await import('./codexDriver')
  const handle = await new CodexAgentDriver().start({
    session: session(mode, resumed),
    cwd: '/tmp',
    env: {},
    mcpServers: [],
    noProviderExecutionHistory: false,
    onEvent: (event) => {
      driverEvents.push(event)
      if (event.type !== 'generated_artifact') events.push(event)
    },
    onClosed: () => {},
  })
  return { driverEvents, events, handle }
}

describe('Codex collaboration modes', () => {
  beforeEach(() => {
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
    const { handle } = await start('plan')
    wire.onRequest?.({
      id: 42,
      method: 'item/tool/requestUserInput',
      params: {
        questions: [{ id: 'scope', header: 'Scope', question: 'Which scope?', options: null }],
      },
    })
    await handle.resolveRequest('42', { answers: { scope: 'All files' } })
    expect(wire.responses).toEqual([{
      id: 42,
      result: { answers: { scope: { answers: ['All files'] } } },
    }])
  })
})
