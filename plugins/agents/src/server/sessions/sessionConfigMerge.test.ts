import { describe, expect, it } from 'vitest'
import { mergeSessionConfigChange } from './sessionConfigMerge'

describe('session configuration merge', () => {
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
