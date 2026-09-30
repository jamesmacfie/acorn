import { describe, expect, it } from 'vitest'
import { mergeSessionConfigChange, retainSessionAuthority } from './sessionConfigMerge'

describe('session configuration merge', () => {
  it('retains admitted identity and authority during replacement and ignores invented identity', () => {
    const identity = {
      workflowRunId: 'run', workflowStepId: 'step', delegationSpawnId: 'spawn',
      customAgent: { id: 'reviewer', instructions: 'Review only.' },
      toolCeiling: { maxRisk: 'read' }, mcpServers: ['approved'],
    }
    expect(retainSessionAuthority({ providerOption: 'changed' }, identity))
      .toEqual({ providerOption: 'changed', ...identity })
    expect(retainSessionAuthority({ ...identity, providerOption: 'changed' }, {}))
      .toEqual({ providerOption: 'changed' })
    expect(retainSessionAuthority(Object.fromEntries(Object.keys(identity).map((key) => [key, 'replaced'])), identity))
      .toEqual(identity)
  })
  it('preserves provider metadata that arrived while a requested option was applied', () => {
    const initialOptions = [{ id: 'model', currentValue: 'opus' }]
    const requestedOptions = [{ id: 'model', currentValue: 'sonnet' }]
    const commands = [{ name: 'review', description: 'Review the current changes.' }]

    expect(mergeSessionConfigChange(
      { configOptions: initialOptions },
      { configOptions: requestedOptions },
      { configOptions: requestedOptions, commands },
    )).toEqual({ configOptions: requestedOptions, commands })
  })

  it('keeps full-replacement semantics for keys the caller changed or removed', () => {
    expect(mergeSessionConfigChange(
      { retained: 'before', changed: 'before', removed: true },
      { retained: 'before', changed: 'after' },
      { retained: 'provider', changed: 'provider', removed: true, added: 'provider' },
    )).toEqual({ retained: 'provider', changed: 'after', added: 'provider' })
  })
})
