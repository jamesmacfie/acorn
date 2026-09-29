import { describe, expect, it } from 'vitest'
import { PrefKeys } from '@acorn/plugin-api/client'
import {
  terminalFontSize,
  terminalFontSizeChoices,
  terminalRailDefault,
  TERMINAL_RAIL_DEFAULT_CHOICES,
} from './terminalPrefs'

// The two terminal preferences, read the way both Settings → Terminal and the palette read them.
//
// One accessor per value is the rule (docs/command-palette-and-shortcuts.md), so what is worth
// pinning is the defaulting: a fresh install and a corrupt value are the cases a second copy of this
// logic would get subtly wrong.

describe('the terminal preferences', () => {
  it('opens the drawer empty until somebody picks a profile, and offers exactly the four it can open', () => {
    expect(terminalRailDefault(undefined)).toBe('empty')
    expect(terminalRailDefault({ [PrefKeys.terminalRailDefault]: 'codex' })).toBe('codex')
    expect(TERMINAL_RAIL_DEFAULT_CHOICES.map((choice) => choice.value))
      .toEqual(['empty', 'shell', 'claude-code', 'codex'])
  })

  it('falls back rather than letting a corrupt size reach xterm’s measurement', () => {
    expect(terminalFontSize({ [PrefKeys.terminalFontSize]: '17' })).toBe(17)
    // Out of bounds, not a number, and absent all mean the shell's own token.
    expect(terminalFontSize({ [PrefKeys.terminalFontSize]: '400' })).toBe(15)
    expect(terminalFontSize({ [PrefKeys.terminalFontSize]: 'large' })).toBe(15)
    expect(terminalFontSize(undefined)).toBe(15)
    expect(terminalFontSizeChoices().map((choice) => choice.value)).toEqual(['13', '15', '17', '19', '21'])
  })

})
