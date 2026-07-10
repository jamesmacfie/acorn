import { describe, expect, it } from 'vitest'
import { agentProfileRegistry, type AgentProfileContribution } from './agentProfiles'
import { listProfileDefs } from './profiles'

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
    expect(codex.aiArgv).toBeUndefined()
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

