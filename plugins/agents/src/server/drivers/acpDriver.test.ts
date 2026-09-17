import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { AgentNormalizedEvent, AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { AgentDriverStartOptions } from './types'
import { AcpDriver, acpMcpServers, clientFor, type PendingRequest } from './acpDriver'
import { harnessCapabilities } from './harness'

const sessionWithRef = (providerSessionRef: string): AgentSession => ({
  id: 'session-1',
  taskId: 'task-1',
  providerId: 'stub',
  profileId: 'stub',
  kind: 'interactive',
  driverKind: 'acp',
  driverVersion: 'acp-1',
  providerSessionRef,
  controller: 'acorn',
  runtimeState: 'creating',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'Stub session',
  model: null,
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [], queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
})

// The generic driver's one branch worth pinning: resolving the two spawn forms into a descriptor
// without spawning anything. `probe()` never throws, so a harness that cannot start shows up as a row
// with a diagnostic rather than as a failed discovery.

describe('the generic ACP driver describes a harness before it starts one', () => {
  it('reports a command-form harness as uninstalled when its CLI is not on PATH', async () => {
    const descriptor = await new AcpDriver({
      id: 'nowhere',
      profileId: 'nowhere',
      label: 'Nowhere',
      spawn: { command: 'acorn-harness-that-does-not-exist', args: ['acp'] },
    }).probe()

    expect(descriptor.installed).toBe(false)
    expect(descriptor.diagnostics).toEqual(['acorn-harness-that-does-not-exist is not available on PATH.'])
    expect(descriptor.executable).toBeUndefined()
    // Never guessed from an id list: no probe was declared, so the health row shows installed-or-not.
    expect(descriptor.authenticated).toBeNull()
  })

  it('reports an entry-form harness as uninstalled when the adapter cannot be resolved', async () => {
    const descriptor = await new AcpDriver({
      id: 'adapterless',
      profileId: 'adapterless',
      label: 'Adapterless',
      spawn: {
        entry: () => {
          throw new Error('no such module')
        },
      },
    }).probe()

    expect(descriptor.installed).toBe(false)
    expect(descriptor.diagnostics).toEqual(['The Adapterless ACP adapter is unavailable.'])
  })

  it('finds a command-form harness on PATH and asks the declared auth probe about it', async () => {
    const asked: string[] = []
    const descriptor = await new AcpDriver({
      // `node` is the one executable this suite can rely on being on PATH.
      id: 'node-harness',
      profileId: 'node-harness',
      label: 'Node harness',
      spawn: { command: 'node' },
      probeAuth: async (executable) => {
        asked.push(executable)
        return true
      },
    }).probe()

    expect(descriptor.installed).toBe(true)
    expect(descriptor.diagnostics).toEqual([])
    expect(descriptor.executable).toMatch(/node$/)
    expect(descriptor.authenticated).toBe(true)
    // Asked about the resolved absolute path, not the bare name.
    expect(asked).toEqual([descriptor.executable])
  })

  // The recovery worth pinning, because the alternative is a session nobody can use: the agent's store
  // no longer holds the reference on the row, and every start retries it and fails.
  it('starts a fresh provider session when the agent no longer has the stored one', async () => {
    const events: AgentNormalizedEvent[] = []
    const handle = await new AcpDriver({
      id: 'stub',
      profileId: 'stub',
      label: 'Stub',
      spawn: {
        entry: () => fileURLToPath(new URL('./__fixtures__/forgetfulAcpAgent.mjs', import.meta.url)),
      },
      quirks: { sessionPersistence: true },
    }).start({
      session: sessionWithRef('d2c6edee-10be-460b-a636-083f68dcde6f'),
      cwd: process.cwd(),
      env: {},
      mcpServers: [],
      noProviderExecutionHistory: false,
      onEvent: (event) => {
        if (event.type !== 'generated_artifact') events.push(event)
      },
      onClosed: () => {},
    })

    try {
      expect(handle.providerSessionRef).toBe('fresh-session-id')
      // The reader is told the agent cannot see the transcript above, and the row's dead reference is
      // replaced by the session_metadata projection.
      expect(events.filter((event) => event.type === 'diagnostic' && event.level === 'warning')).toHaveLength(1)
      expect(events).toContainEqual(expect.objectContaining({ type: 'session_state', state: 'ready' }))
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'session_metadata', providerSessionRef: 'fresh-session-id' }),
      )
    } finally {
      await handle.stop()
    }
  })

  // The other half of the reconnect, and the one acorn used to miss. An agent that keeps its sessions
  // may offer `session/resume` instead of `session/load`, which is what DeepSeek's ACP server does, and
  // acorn reading only the older capability meant a fresh agent under the old transcript every time.
  it('resumes a stored provider session when the agent offers resume rather than load', async () => {
    const events: AgentNormalizedEvent[] = []
    const handle = await new AcpDriver({
      id: 'stub',
      profileId: 'stub',
      label: 'Stub',
      spawn: {
        entry: () => fileURLToPath(new URL('./__fixtures__/resumableAcpAgent.mjs', import.meta.url)),
      },
      // No quirks on purpose: which reconnect an agent supports is on the wire, so a harness declares
      // nothing to get this.
    }).start({
      session: sessionWithRef('d2c6edee-10be-460b-a636-083f68dcde6f'),
      cwd: process.cwd(),
      env: {},
      mcpServers: [],
      noProviderExecutionHistory: false,
      onEvent: (event) => {
        if (event.type !== 'generated_artifact') events.push(event)
      },
      onClosed: () => {},
    })

    try {
      expect(handle.providerSessionRef).toBe('d2c6edee-10be-460b-a636-083f68dcde6f')
      // Nothing was lost, so the reader is told nothing.
      expect(events.filter((event) => event.type === 'diagnostic')).toHaveLength(0)
      expect(events).toContainEqual(expect.objectContaining({ type: 'session_state', state: 'ready' }))
    } finally {
      await handle.stop()
    }
  })

  it('starts a fresh provider session when a resuming agent refuses the stored one', async () => {
    const events: AgentNormalizedEvent[] = []
    const handle = await new AcpDriver({
      id: 'stub',
      profileId: 'stub',
      label: 'Stub',
      spawn: {
        entry: () => fileURLToPath(new URL('./__fixtures__/resumableAcpAgent.mjs', import.meta.url)),
      },
    }).start({
      session: sessionWithRef('unresumable-session-id'),
      cwd: process.cwd(),
      env: {},
      mcpServers: [],
      noProviderExecutionHistory: false,
      onEvent: (event) => {
        if (event.type !== 'generated_artifact') events.push(event)
      },
      onClosed: () => {},
    })

    try {
      // Resume answers invalid params rather than resource-not-found, and it is the same dead reference.
      expect(handle.providerSessionRef).toBe('fresh-session-id')
      expect(events.filter((event) => event.type === 'diagnostic' && event.level === 'warning')).toHaveLength(1)
    } finally {
      await handle.stop()
    }
  })

  // ACP spells an environment as an ordered list of pairs, so a server naming the same variable twice
  // is a protocol error the agent reports rather than a silent last-wins.
  it('hands acorn\u2019s own tool server to the agent as ordered environment pairs', () => {
    expect(acpMcpServers([{
      name: 'acorn-dev',
      command: '/opt/acorn/node',
      args: ['/opt/acorn/mcp.js'],
      env: { ACORN_MCP_NAME: 'acorn-dev', ACORN_API_TOKEN: 'signed' },
    }])).toEqual([{
      name: 'acorn-dev',
      command: '/opt/acorn/node',
      args: ['/opt/acorn/mcp.js'],
      env: [
        { name: 'ACORN_MCP_NAME', value: 'acorn-dev' },
        { name: 'ACORN_API_TOKEN', value: 'signed' },
      ],
    }])
    expect(acpMcpServers([])).toEqual([])
  })

  it('derives capabilities from the protocol baseline plus the declared quirks', () => {
    expect(harnessCapabilities(undefined)).not.toContain('resume')
    expect(harnessCapabilities(undefined)).not.toContain('compact')
    expect(harnessCapabilities({ sessionPersistence: true })).toContain('resume')
    expect(harnessCapabilities({ manualCompaction: true })).toContain('compact')
    // The baseline is what the protocol defines and the shared normalizer maps, so it holds for every
    // ACP harness whether or not that harness declares anything.
    expect(harnessCapabilities(undefined)).toContain('permissions')
  })
})

// The parked-request path, driven without a child process. `clientFor` is everything the agent calls
// back into, and both kinds of question park in the same map and leave it by different doors.
describe('the generic ACP driver parks a question until somebody answers it', () => {
  const elicitation = {
    mode: 'form' as const,
    sessionId: 'acp-session',
    message: 'Which one?',
    requestedSchema: {
      type: 'object' as const,
      properties: { pick: { type: 'string', enum: ['first', 'second'] } },
    },
  }

  const parked = () => {
    const events: AgentNormalizedEvent[] = []
    const pending = new Map<string, PendingRequest>()
    const options = { onEvent: async (event: AgentNormalizedEvent) => { events.push(event) } }
    return { events, pending, client: clientFor(options as AgentDriverStartOptions, 'Stub', pending, () => false) }
  }

  it('asks the session, then answers the agent with the value behind the label', async () => {
    const { events, pending, client } = parked()
    const response = client.unstable_createElicitation!(elicitation)
    const [requestId] = [...pending.keys()]
    pending.get(requestId)!.resolve({ answers: { pick: 'second' } })
    expect(await response).toEqual({ action: 'accept', content: { pick: 'second' } })
    expect(events[0]).toMatchObject({ type: 'request', kind: 'question', requestId, title: 'Which one?' })
  })

  it('cancels a question the turn left behind rather than answering it empty', async () => {
    const { pending, client } = parked()
    const response = client.unstable_createElicitation!(elicitation)
    for (const request of pending.values()) request.drain()
    expect(await response).toEqual({ action: 'cancel' })
  })

  it('still answers a permission in the permission protocol', async () => {
    const { pending, client } = parked()
    const response = client.requestPermission({
      sessionId: 'acp-session',
      toolCall: { toolCallId: 'tool-1', title: 'Run the tests' },
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
    })
    const [requestId] = [...pending.keys()]
    pending.get(requestId)!.resolve({ optionId: 'allow' })
    expect(await response).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
  })
})

// The failure this prevents is a session nobody can use: the ACP request is never answered, so the
// agent's own promise never settles, and the durable row sits in "Needs you" with nothing behind it.
describe('a question the agent stopped waiting for is released with the turn', () => {
  it('answers it and tells the session, rather than leaving it parked', async () => {
    const events: AgentNormalizedEvent[] = []
    const handle = await new AcpDriver({
      id: 'stub',
      profileId: 'stub',
      label: 'Stub',
      spawn: {
        entry: () => fileURLToPath(new URL('./__fixtures__/inquisitiveAcpAgent.mjs', import.meta.url)),
      },
    }).start({
      session: sessionWithRef(''),
      cwd: process.cwd(),
      env: {},
      mcpServers: [],
      noProviderExecutionHistory: false,
      onEvent: (event) => { if (event.type !== 'generated_artifact') events.push(event) },
      onClosed: () => {},
    })

    try {
      await handle.sendTurn({ turn: {} as never, input: [{ type: 'text', text: 'go' }], attachments: {} })
      const asked = events.filter((event) => event.type === 'request')
      expect(asked).toHaveLength(1)
      expect(events).toContainEqual({
        type: 'request_resolved',
        requestId: asked[0].type === 'request' ? asked[0].requestId : '',
        resolution: { cancelled: true },
      })
      // And the session can take another turn.
      expect(handle.ready).toBe(true)
    } finally {
      await handle.stop()
    }
  })
})
