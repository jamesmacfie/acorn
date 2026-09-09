import { describe, expect, it } from 'vitest'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'
registerBuiltInProfiles() // register the built-in profiles into the registry under test
import { agentProfileRegistry, type AgentProfileContribution } from '@acorn/node-core/server/agentProfiles/index.ts'
import { listProfileDefs } from '@acorn/node-core/server/profiles.ts'

describe('agent profile registry', () => {
  it('declares each built-in spawn/resume/MCP/stream/one-shot capability explicitly', () => {
    const claude = agentProfileRegistry.require('claude-code')
    expect(claude).toMatchObject({ command: 'claude', backendPreference: 'tmux' })
    expect(claude.headlessArgv).toBeTypeOf('function')
    expect(claude.resumeArgv?.('claude', 's1')).toEqual({ file: 'claude', args: ['--resume', 's1'] })
    expect(claude.mcpRegistration).toBeTypeOf('function')
    expect(claude.streamJson).toBeDefined()
    expect(claude.aiArgv?.('claude', { prompt: 'choose', schema: { type: 'object' } }).args).toContain('--tools')

    const codex = agentProfileRegistry.require('codex')
    expect(codex.resumeArgv?.('codex', 's2')).toEqual({ file: 'codex', args: ['resume', 's2'] })
    // Codex has a one-shot mode of its own since 2026-09-09, where this used to assert it had none.
    // `-s read-only` stands in for claude's empty `--tools`, and `--skip-git-repo-check` is what lets
    // it start in the empty directory a one-shot generate runs in.
    expect(codex.aiArgv?.('codex', { prompt: 'choose' }).args).toEqual(['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', 'choose'])
  })

  it('adds a profile through one registration and every dynamic consumer sees it', () => {
    const profile: AgentProfileContribution = {
      id: 'fixture-agent',
      label: 'Fixture Agent',
      kind: 'agent',
      command: 'fixture-agent',
      backendPreference: 'node-pty',
      transport: 'pty',
    }
    const dispose = agentProfileRegistry.register(profile)
    try {
      expect(listProfileDefs()).toContain(profile)
    } finally {
      dispose()
    }
    expect(listProfileDefs()).not.toContain(profile)
  })
})
