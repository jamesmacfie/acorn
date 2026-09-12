import { describe, expect, it } from 'vitest'
import { paletteFor, reportsTruecolor, slotColor, TERMINAL_PALETTE } from './appearance'
import { osc52, supportsClipboard } from './kit/copy'

// The two places this host decides something about the terminal rather than about the kit. Neither
// needs a renderer, so neither is skipped on an older Node.

describe('the palette', () => {
  // The light-terminal bug, as an assertion. Every slot is a question for the terminal rather than a
  // colour of ours: the reader's own foreground, or one of their sixteen numbered slots. A hex here
  // would be acorn's theme drawn over the one they chose (./colour.ts).
  it('asks the terminal for every slot, including the one no role names', () => {
    expect(slotColor('default')).toBe('default')
    expect(slotColor(undefined)).toBe('default')
    for (const slot of ['muted', 'accent', 'ok', 'warn', 'danger'] as const) {
      expect(typeof slotColor(slot)).toBe('number')
    }
  })

  it('defaults to the terminal’s own slots, which is the theme the person chose', () => {
    expect(paletteFor({ '--accent': '#ff0000' }, false)).toEqual(TERMINAL_PALETTE)
  })

  it('passes a theme’s hexes through where the terminal says it can take them', () => {
    const palette = paletteFor({ '--accent': '#8be9fd', '--state-ok': '#50fa7b' }, true)
    expect(palette.accent).toEqual([0x8b, 0xe9, 0xfd])
    expect(palette.ok).toEqual([0x50, 0xfa, 0x7b])
    // Untouched tokens keep the terminal's slot rather than becoming undefined.
    expect(palette.warn).toBe(TERMINAL_PALETTE.warn)
  })

  it('refuses a colour a terminal cannot take, even in truecolor', () => {
    // A theme may write `oklch(...)`, which is a perfectly good CSS colour and nothing to a terminal.
    // Falling back to the slot draws the right sort of colour; passing it through draws nothing.
    expect(paletteFor({ '--accent': 'oklch(0.7 0.15 250)' }, true).accent).toBe(TERMINAL_PALETTE.accent)
  })

  it('reads truecolor off the environment', () => {
    expect(reportsTruecolor({ COLORTERM: 'truecolor' })).toBe(true)
    expect(reportsTruecolor({ COLORTERM: '24bit' })).toBe(true)
    expect(reportsTruecolor({})).toBe(false)
  })
})

describe('the clipboard', () => {
  it('knows the terminals that take OSC 52, and takes the override either way', () => {
    expect(supportsClipboard({ TERM_PROGRAM: 'WezTerm' })).toBe(true)
    expect(supportsClipboard({ TERM: 'xterm-256color' })).toBe(true)
    expect(supportsClipboard({ TERM: 'dumb' })).toBe(false)
    expect(supportsClipboard({ TERM: 'dumb', ACORN_TUI_OSC52: '1' })).toBe(true)
    expect(supportsClipboard({ TERM: 'xterm', ACORN_TUI_OSC52: '0' })).toBe(false)
  })

  it('base64s the payload, so nothing in the text can end the sequence early', () => {
    // The one thing that makes this safe to hand arbitrary note text: a bell or an escape inside the
    // value cannot close the sequence and leave the rest of it on the screen as commands.
    const sequence = osc52('bel \u0007 and esc \u001b')
    const body = sequence.slice('\u001b]52;c;'.length, -1)
    expect(sequence.startsWith('\u001b]52;c;')).toBe(true)
    expect(sequence.endsWith('\u0007')).toBe(true)
    expect(body).toMatch(/^[A-Za-z0-9+/=]*$/)
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('bel \u0007 and esc \u001b')
  })
})
