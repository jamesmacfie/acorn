import { describe, expect, it } from 'vitest'
import type { AgentConfigOption, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { sameAgentConfigOptions, sessionModelLabel } from './agentConfigOptions'

const options = (): AgentConfigOption[] => [{
  id: 'model',
  label: 'Model',
  category: 'model',
  currentValue: 'gpt-5.6-sol',
  values: [
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Frontier coding model' },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  ],
}]

describe('managed-agent configuration stability', () => {
  it('treats re-hydrated but unchanged provider options as equal', () => {
    expect(sameAgentConfigOptions(options(), options())).toBe(true)
  })

  it('invalidates the projection when selection or advertised values change', () => {
    const selected = options()
    selected[0] = { ...selected[0], currentValue: 'gpt-5.6-terra' }
    expect(sameAgentConfigOptions(options(), selected)).toBe(false)

    const advertised = options()
    advertised[0] = {
      ...advertised[0],
      values: [...advertised[0].values, { value: 'new', label: 'New model' }],
    }
    expect(sameAgentConfigOptions(options(), advertised)).toBe(false)
  })
})

const session = (config: Record<string, unknown>, model: string | null = null): AgentSession => ({
  id: 'session-1',
  taskId: 'task-1',
  providerId: 'claude',
  profileId: 'claude',
  kind: 'interactive',
  driverKind: 'acp',
  driverVersion: '1',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'ready',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'A session',
  model,
  config,
  parentSessionId: null,
  parentTurnId: null,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
})

describe('the model a session is running', () => {
  it('reads the live provider option, not the unwritten column', () => {
    expect(sessionModelLabel(session({ configOptions: options() }))).toBe('GPT-5.6 Sol')
  })

  it('falls back to the raw value when the provider advertised no label for it', () => {
    const unlabelled = options()
    unlabelled[0] = { ...unlabelled[0], values: [] }
    expect(sessionModelLabel(session({ configOptions: unlabelled }))).toBe('gpt-5.6-sol')
  })

  it('falls back to the column when no provider option is on the session yet', () => {
    expect(sessionModelLabel(session({}, 'gpt-5.6-terra'))).toBe('gpt-5.6-terra')
    expect(sessionModelLabel(session({ configOptions: [] }))).toBeUndefined()
  })
})
