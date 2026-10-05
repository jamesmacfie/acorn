import { describe, expect, it } from 'vitest'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'
import { choiceDescription, newSessionChoices } from './newSessionChoices'

const provider = (id: string, installed = true) => ({
  id, profileId: id, label: id === 'codex' ? 'Codex' : 'Claude Code', installed, diagnostics: ['Not on PATH'],
}) as AgentProviderDescriptor

const agent = (id: string, providerId: string): CustomAgent => ({
  id, name: id, providerId, profileId: providerId, options: { reasoning: 'high' }, source: { kind: 'user' },
})

describe('new session choices', () => {
  it('lists harnesses, then agents, and drops an agent whose harness is not registered', () => {
    const choices = newSessionChoices([provider('claude'), provider('codex', false)], [
      agent('Reviewer', 'codex'), agent('Orphan', 'gone'),
    ])
    expect(choices.map((choice) => choice.agent?.name ?? choice.provider.id)).toEqual(['claude', 'codex', 'Reviewer'])
    // An agent on an uninstalled harness says why it cannot start.
    expect(choiceDescription(choices[2]!)).toBe('Not on PATH')
    expect(choiceDescription({ provider: provider('codex'), agent: agent('Reviewer', 'codex') })).toBe('Codex · high')
  })

  it('leaves out a hidden harness and the agents built on it', () => {
    const choices = newSessionChoices([provider('claude'), provider('codex')], [
      agent('Reviewer', 'codex'), agent('Writer', 'claude'),
    ], ['codex'])
    expect(choices.map((choice) => choice.agent?.name ?? choice.provider.id)).toEqual(['claude', 'Writer'])
  })
})
