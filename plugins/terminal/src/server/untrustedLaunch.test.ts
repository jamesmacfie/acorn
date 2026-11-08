import { describe, expect, it } from 'vitest'
import type { AgentProfileContribution } from '@acorn/plugin-api/node'
import { untrustedTerminalArgs } from './untrustedLaunch'

const profile = (over: Partial<AgentProfileContribution>): AgentProfileContribution => ({
  id: 'agent',
  label: 'Agent',
  kind: 'agent',
  command: 'agent',
  backendPreference: 'node-pty',
  transport: 'pty',
  ...over,
})

describe('an interactive agent in an untrusted project', () => {
  it('puts the lock-down flags first and the untrusted line ahead of the task context', () => {
    const locked = profile({
      untrustedArgs: ['--setting-sources', 'user'],
      launchContextArgs: (context) => ['--append-system-prompt', context ?? ''],
    })
    expect(untrustedTerminalArgs(locked, 'Task context')).toEqual([
      '--setting-sources',
      'user',
      '--append-system-prompt',
      expect.stringMatching(/^This repository is untrusted\..*\n\nTask context$/s),
    ])
  })

  it("refuses a profile that can't lock down", () => {
    expect(() => untrustedTerminalArgs(profile({ launchArgs: ['--yolo'] }), null)).toThrow(
      "can't run in an untrusted project",
    )
  })
})
