import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProviderDescriptor } from '../contract/wire.ts'
import type { CustomAgent } from '../shared/customAgents'

const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  enqueue: vi.fn(),
  readJson: vi.fn(),
  startSession: vi.fn(),
  openManagedSession: vi.fn(),
}))
vi.mock('./sessions/managedClient', () => ({
  managedAgentApi: { providers: mocks.providers, enqueue: mocks.enqueue },
}))
vi.mock('./sessions/managedSelection', () => ({ openManagedSession: mocks.openManagedSession }))
vi.mock('./sessions/managedStore', () => ({ managedAgentStore: { startSession: mocks.startSession } }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readJson: mocks.readJson,
}))

import { choiceLabel, newSessionChoices } from '../contract/newSessionChoices.ts'
import { managedDraft } from './sessions/managedDrafts'
import { agentSessionStarter } from './sessionStarter'

// Core's way to start an agent with a draft. What is pinned: the choices are New's rows under a key
// that survives the round trip, and a start leaves the draft in the composer without sending a turn.

const provider = (over: Partial<AgentProviderDescriptor> = {}): AgentProviderDescriptor => ({
  id: 'claude-code',
  profileId: 'claude-code',
  label: 'Claude Code',
  driverKind: 'acp',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
  ...over,
})

const providers = [
  provider(),
  provider({ id: 'codex', profileId: 'codex-default', label: 'Codex' }),
  provider({ id: 'gemini', profileId: 'gemini', label: 'Gemini', installed: false }),
]
const reviewer: CustomAgent = {
  id: 'a1',
  name: 'Bug reviewer',
  providerId: 'codex',
  profileId: 'codex-default',
  options: {},
  source: { kind: 'user' },
} as CustomAgent

describe('the agent session starter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.providers.mockResolvedValue(providers)
    mocks.readJson.mockResolvedValue([reviewer])
    mocks.startSession.mockImplementation(async () => ({ id: `s-${mocks.startSession.mock.calls.length}` }))
  })

  it("lists New's rows, in New's order", async () => {
    const choices = await agentSessionStarter.choices()
    expect(choices).toEqual([
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'codex', label: 'Codex' },
      { id: 'custom-agent:a1', label: 'Bug reviewer' },
    ])
    expect(choices.map((choice) => choice.label)).toEqual(newSessionChoices(providers, [reviewer]).map(choiceLabel))
  })

  it('starts the chosen agent with the draft in its composer, and sends nothing', async () => {
    const sessionId = await agentSessionStarter.start({
      taskId: 'task-1',
      title: 'Build Weather',
      choiceId: 'custom-agent:a1',
      draft: 'What it should do:',
    })
    expect(mocks.startSession).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ id: 'codex', profileId: 'codex-default' }),
      { customAgentId: 'a1', title: 'Build Weather' },
    )
    expect(managedDraft(sessionId)).toBe('What it should do:')
    expect(mocks.openManagedSession).toHaveBeenCalledWith('task-1', sessionId)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('starts the first row when no agent is chosen', async () => {
    await agentSessionStarter.start({ taskId: 'task-1', title: 'Build Weather', draft: 'x' })
    expect(mocks.startSession).toHaveBeenCalledWith('task-1', expect.objectContaining({ id: 'claude-code' }), {
      title: 'Build Weather',
    })
  })

  it('refuses an agent that is no longer offered', async () => {
    await expect(
      agentSessionStarter.start({ taskId: 'task-1', title: 'Build Weather', choiceId: 'gemini', draft: 'x' }),
    ).rejects.toThrow("That agent isn't available any more. Pick another.")
    expect(mocks.startSession).not.toHaveBeenCalled()
  })
})
