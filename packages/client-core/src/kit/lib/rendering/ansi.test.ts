import { describe, expect, it } from 'vitest'
import { hasAnsi, keepAnsiColour, stripAnsi } from './ansi'

// `tput sgr0` on an xterm terminal, which is what a shell profile writes before a command's output.
const SGR0 = '\x1b(B\x1b[m'

describe('stripAnsi', () => {
  it('removes the reset a shell profile writes', () => {
    expect(stripAnsi(`${SGR0}// Runs the suite`)).toBe('// Runs the suite')
  })

  it('removes colour, cursor, title, and hyperlink codes', () => {
    const text = '\x1b[34mdesktop\x1b[39;49m\x1b[0m \x1b[2K\x1b[?25h\x1b]0;title\x07\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\'
    expect(stripAnsi(text)).toBe('desktop link')
  })

  it('removes stray control bytes and keeps tabs and line breaks', () => {
    expect(stripAnsi('a\x07b\x08c\td\r\ne\x1b')).toBe('abc\td\r\ne')
  })
})

describe('keepAnsiColour', () => {
  it('keeps colour codes and drops everything else', () => {
    expect(keepAnsiColour(`${SGR0}\x1b[1;31mred\x1b[0m \x1b]8;;http://x\x07link\x1b]8;;\x07 \x1b[38;5;208morange\x1b[m`))
      .toBe('\x1b[m\x1b[1;31mred\x1b[0m link \x1b[38;5;208morange\x1b[m')
  })
})

describe('hasAnsi', () => {
  it('is false for plain output', () => {
    expect(hasAnsi('line one\n\tline two\r\n')).toBe(false)
    expect(hasAnsi('\x1b[31mred')).toBe(true)
  })
})
