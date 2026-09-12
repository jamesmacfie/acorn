import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentProfileRegistry } from '../../main/agentProfiles'
import { lineDelimitedJsonAdapter } from '../../main/agentProfiles/streamJson'
import { ProviderRequestScheduler } from '../integrations/budgetRuntime'
import { generateTextForHarness } from './harnessRuntime'

describe('generateTextForHarness', () => {
  let dispose: (() => void) | undefined

  afterEach(() => dispose?.())

  it('runs the profile one-shot in an empty directory and returns its text', async () => {
    const aiArgv = vi.fn((_command: string, _options: { prompt: string; system?: string }) => ({
      file: '/bin/sh',
      args: ['-c', "test ! -e AGENTS.md && printf '%s\\n' '{\"type\":\"result\",\"result\":\"A short title\",\"model\":\"test-model\"}'"],
    }))
    dispose = agentProfileRegistry.register({
      id: 'title-harness-test',
      label: 'Title harness test',
      kind: 'agent',
      command: '/bin/sh',
      backendPreference: 'node-pty',
      transport: 'pty',
      aiArgv,
      streamJson: lineDelimitedJsonAdapter,
    })

    await expect(generateTextForHarness({
      profileId: 'title-harness-test',
      input: { system: 'System rules', prompt: 'User prompt', maxOutputTokens: 64 },
      timeoutMs: 1_000,
    }, new ProviderRequestScheduler())).resolves.toMatchObject({
      text: 'A short title',
      providerId: 'title-harness-test',
      connectionId: 'harness:title-harness-test',
      modelId: 'test-model',
    })
    expect(aiArgv).toHaveBeenCalledWith('/bin/sh', {
      prompt: 'User prompt',
      system: 'System rules',
    })
  })
})
