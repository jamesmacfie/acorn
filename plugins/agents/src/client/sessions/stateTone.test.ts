import { describe, expect, it } from 'vitest'
import { runtimeTone, subagentTone } from './stateTone'

describe('agent state tones', () => {
  it('renders completed subagents with the same muted tone as completed sessions', () => {
    expect(subagentTone('completed')).toBe('muted')
    expect(subagentTone('completed')).toBe(runtimeTone('ready'))
  })
})
