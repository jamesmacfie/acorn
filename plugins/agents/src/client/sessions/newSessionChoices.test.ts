import { describe, expect, it } from 'vitest'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import type { CustomAgent } from '../../shared/customAgents'
import {
  choiceAccountIcon,
  choiceDescription,
  choiceLabel,
  choiceStart,
  choiceText,
  newSessionChoices,
  providerStartable,
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
  it('lists harnesses, then agents, and drops what cannot start', () => {
    const choices = newSessionChoices(
      [provider('claude'), provider('codex', false)],
      [agent('Writer', 'claude'), agent('Reviewer', 'codex'), agent('Orphan', 'gone')],
    )
    expect(choices.map((choice) => choice.agent?.name ?? choice.provider.id)).toEqual(['claude', 'Writer'])
    expect(choiceDescription({ provider: provider('codex'), agent: agent('Reviewer', 'codex') })).toBe('Codex · high')
  })

  it('drops a harness whose own login is signed out, and its agents with it', () => {
    const codex = { ...provider('codex'), authenticated: false }
    expect(newSessionChoices([provider('claude'), codex], [agent('Reviewer', 'codex')]).map(choiceLabel)).toEqual([
      'Claude Code',
    ])
    expect([provider('claude'), codex, provider('codex', false)].map(providerStartable)).toEqual([true, false, false])
  })

  it('lists a harness with extra accounts as its signed-in accounts only', () => {
    const claude = {
      ...provider('claude'),
      accounts: [
        { name: 'work', authenticated: true, loginCommand: null },
        { name: 'old', authenticated: false, loginCommand: null },
      ],
    }
    const choices = newSessionChoices([claude, provider('codex')], [])
    expect(choices.map(choiceLabel)).toEqual(['Claude Code · work', 'Codex'])
    expect(choiceStart(choices[0]!)).toEqual({ account: 'work' })
    // An agent runs on the default account, so a signed-out default drops it while `work` stays.
    const signedOutDefault = { ...claude, defaultAccount: 'old' }
    expect(newSessionChoices([signedOutDefault], [agent('Writer', 'claude')]).map(choiceLabel)).toEqual([
      'Claude Code · work',
    ])
    expect(
      newSessionChoices([signedOutDefault], [{ ...agent('Writer', 'claude'), account: 'work' }]).map(choiceLabel),
    ).toEqual(['Claude Code · work', 'Writer'])
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
