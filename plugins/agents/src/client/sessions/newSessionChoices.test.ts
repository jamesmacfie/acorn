import { describe, expect, it } from 'vitest'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'
import {
  choiceAccountIcon,
  choiceAvailable,
  choiceDescription,
  choiceLabel,
  choiceStart,
  choiceText,
  newSessionChoices,
} from '../../contract/newSessionChoices.ts'

const provider = (id: string, installed = true) =>
  ({
    id,
    profileId: id,
    label: id === 'codex' ? 'Codex' : 'Claude Code',
    installed,
    diagnostics: ['Not on PATH'],
  }) as AgentProviderDescriptor

const agent = (id: string, providerId: string): CustomAgent => ({
  id,
  name: id,
  providerId,
  profileId: providerId,
  options: { reasoning: 'high' },
  source: { kind: 'user' },
})

describe('new session choices', () => {
  it('lists harnesses, then agents, and drops an agent whose harness is not registered', () => {
    const choices = newSessionChoices(
      [provider('claude'), provider('codex', false)],
      [agent('Reviewer', 'codex'), agent('Orphan', 'gone')],
    )
    expect(choices.map((choice) => choice.agent?.name ?? choice.provider.id)).toEqual(['claude', 'codex', 'Reviewer'])
    // An agent on an uninstalled harness says why it cannot start.
    expect(choiceDescription(choices[2]!)).toBe('Not on PATH')
    expect(choiceDescription({ provider: provider('codex'), agent: agent('Reviewer', 'codex') })).toBe('Codex · high')
  })

  it('lists a harness with extra accounts as those accounts only, and a signed-out one cannot start', () => {
    const claude = {
      ...provider('claude'),
      accounts: [
        { name: 'work', authenticated: true, loginCommand: null },
        { name: 'old', authenticated: false, loginCommand: null },
      ],
    }
    expect(newSessionChoices([{ ...claude, defaultAccount: 'old' }], []).map(choiceLabel)).toEqual([
      'Claude Code · old',
      'Claude Code · work',
    ])
    const choices = newSessionChoices([claude, provider('codex')], [])
    expect(choices.map(choiceLabel)).toEqual(['Claude Code · work', 'Claude Code · old', 'Codex'])
    expect(choices.map(choiceAvailable)).toEqual([true, false, true])
    expect(choiceStart(choices[0]!)).toEqual({ account: 'work' })
    expect(choiceDescription(choices[1]!)).toMatch(/Not signed in/)
  })

  it("draws an account's icon in place of its name only when the harness shows icons", () => {
    const claude = {
      ...provider('claude'),
      accounts: [
        { name: 'work', icon: 'briefcase', authenticated: true, loginCommand: null },
        { name: 'home', authenticated: true, loginCommand: null },
      ],
    }
    const named = newSessionChoices([claude], [])
    expect(named.map(choiceText)).toEqual(['Claude Code · work', 'Claude Code · home'])
    expect(named.map(choiceAccountIcon)).toEqual([undefined, undefined])
    const iconed = newSessionChoices([{ ...claude, accountDisplay: 'icon' }], [])
    expect(iconed.map(choiceText)).toEqual(['Claude Code', 'Claude Code · home'])
    expect(iconed.map(choiceAccountIcon)).toEqual(['briefcase', undefined])
    expect(iconed.map(choiceLabel)).toEqual(['Claude Code · work', 'Claude Code · home'])
    const renamed = newSessionChoices([{ ...claude, accounts: [{ ...claude.accounts[0]!, label: 'Acme' }] }], [])
    expect(renamed.map(choiceLabel)).toEqual(['Claude Code · Acme'])
  })
})
