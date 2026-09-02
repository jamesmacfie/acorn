import { describe, expect, it } from 'vitest'
import { detectBackend, notification, sanitise, sequence, wrapTmux } from './notify'

// The sequences byte for byte, because there is no reply to check them against: a terminal that does
// not understand one ignores it in silence, so the only place a mistake can be caught is here.
// The backend table and each sequence are documented in docs/notifications.md § The channels.

const ESC = '\u001b'

describe('which terminal takes which sequence', () => {
  it('reads the four OSC 9 terminals off TERM_PROGRAM', () => {
    expect(detectBackend({ TERM_PROGRAM: 'iTerm.app' })).toBe('osc9')
    expect(detectBackend({ TERM_PROGRAM: 'ghostty' })).toBe('osc9')
    expect(detectBackend({ TERM_PROGRAM: 'WezTerm' })).toBe('osc9')
    expect(detectBackend({ TERM_PROGRAM: 'WarpTerminal' })).toBe('osc9')
  })

  it('finds kitty by its window id or its terminfo entry, inside tmux as well as out', () => {
    expect(detectBackend({ KITTY_WINDOW_ID: '1' })).toBe('osc99')
    expect(detectBackend({ TERM: 'xterm-kitty' })).toBe('osc99')
    // Inside tmux `TERM` is tmux's, so the window id is the only thing left saying kitty.
    expect(detectBackend({ KITTY_WINDOW_ID: '1', TERM: 'screen-256color', TMUX: '/tmp/x' })).toBe('osc99')
  })

  it('falls back to TERM, and answers nothing for a terminal that says nothing', () => {
    expect(detectBackend({ TERM: 'xterm-ghostty' })).toBe('osc9')
    expect(detectBackend({ TERM: 'wezterm' })).toBe('osc9')
    expect(detectBackend({ TERM: 'rxvt-unicode-256color' })).toBe('osc777')
    expect(detectBackend({ TERM: 'xterm-256color' })).toBe(null)
    expect(detectBackend({})).toBe(null)
  })
})

describe('the sequences', () => {
  it('writes OSC 9 as one string, with the body after a colon', () => {
    expect(sequence('osc9', 'claude finished')).toBe(`${ESC}]9;claude finished${ESC}\\`)
    expect(sequence('osc9', 'claude finished', 'fix-login')).toBe(`${ESC}]9;claude finished: fix-login${ESC}\\`)
  })

  it('writes OSC 99 as kitty does: one notification, title then body', () => {
    expect(sequence('osc99', 'claude finished')).toBe(`${ESC}]99;;claude finished${ESC}\\`)
    expect(sequence('osc99', 'claude finished', 'fix-login')).toBe(
      `${ESC}]99;i=1:d=0;claude finished${ESC}\\${ESC}]99;i=1:p=body;fix-login${ESC}\\`,
    )
  })

  it('writes OSC 777 as two fields, and keeps a title out of the field separator', () => {
    expect(sequence('osc777', 'claude finished', 'fix-login')).toBe(
      `${ESC}]777;notify;claude finished;fix-login${ESC}\\`,
    )
    expect(sequence('osc777', 'stop; drop')).toBe(`${ESC}]777;notify;stop, drop;${ESC}\\`)
  })

  it('strips what would end the sequence early, and flattens what would break the line', () => {
    expect(sanitise(`a\n\tb${ESC}c`)).toBe('a  bc')
  })

  it('doubles every ESC for tmux to pass through', () => {
    expect(wrapTmux(`${ESC}]9;hi${ESC}\\`)).toBe(`${ESC}Ptmux;${ESC}${ESC}]9;hi${ESC}${ESC}\\${ESC}\\`)
  })
})

describe('what actually gets written', () => {
  const warp = { TERM_PROGRAM: 'WarpTerminal' }

  it('wraps for tmux only when tmux is there', () => {
    expect(notification('done', undefined, warp)).toBe(`${ESC}]9;done${ESC}\\`)
    expect(notification('done', undefined, { ...warp, TMUX: '/tmp/x' })).toContain(`${ESC}Ptmux;`)
  })

  it('writes nothing when the mode says not to, and nothing on a terminal that takes none', () => {
    expect(notification('done', undefined, { ...warp, ACORN_TUI_NOTIFY: 'off' })).toBe('')
    expect(notification('done', undefined, { ...warp, ACORN_TUI_NOTIFY: 'bell' })).toBe('')
    expect(notification('done', undefined, { ...warp, ACORN_TUI_NOTIFY: 'terminal' })).not.toBe('')
    expect(notification('done', undefined, { TERM: 'xterm-256color' })).toBe('')
  })
})
