import { QueryClient } from '@tanstack/solid-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { PrefKeys } from '@acorn/plugin-api/client'
import {
  AGENT_TOOL_FOLD_CHOICES,
  defaultAgentToolFoldPrefs,
  readAgentToolFoldPrefs,
  saveAgentToolFoldMode,
} from './toolFoldPrefs'

// The mode and the reader's last toggle share one key, so choosing a mode must not forget the toggle:
// switching to `sticky` and back would otherwise lose which way the cards were left. Settings → Agent
// defaults and the palette's setting command both write through `saveAgentToolFoldMode`.

const stored = (): Record<string, string> => ({
  [PrefKeys.agentToolFold]: localStorage.getItem(`acorn-pref:${PrefKeys.agentToolFold}`) ?? '',
})

describe('the tool-card fold preference', () => {
  beforeEach(() => localStorage.clear())

  it('starts collapsed, and reads a corrupt value as the default rather than as a mode', () => {
    expect(readAgentToolFoldPrefs(undefined)).toEqual(defaultAgentToolFoldPrefs)
    expect(readAgentToolFoldPrefs({ [PrefKeys.agentToolFold]: '{"mode":"sideways"}' })).toEqual(defaultAgentToolFoldPrefs)
    expect(AGENT_TOOL_FOLD_CHOICES.map((choice) => choice.value)).toEqual(['collapsed', 'expanded', 'sticky'])
  })

  it('keeps the reader’s last toggle when the mode changes', async () => {
    const qc = new QueryClient()
    localStorage.setItem(`acorn-pref:${PrefKeys.agentToolFold}`, JSON.stringify({ mode: 'sticky', last: 'expanded' }))
    await saveAgentToolFoldMode(qc, stored(), 'collapsed')
    expect(readAgentToolFoldPrefs(stored())).toEqual({ mode: 'collapsed', last: 'expanded' })
  })
})
