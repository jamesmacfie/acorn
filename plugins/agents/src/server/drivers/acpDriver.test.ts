import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { AgentNormalizedEvent, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { AcpDriver } from './acpDriver'
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
  subagents: [],
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
      noProviderExecutionHistory: false,
      onEvent: (event) => {
        events.push(event)
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
