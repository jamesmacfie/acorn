import { describe, expect, it } from 'vitest'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { ansiPalette } from './theme'

// The palette derivation is a key-name mapping (terminal.ansiBrightRed → brightRed); run it
// against the real theme JSONs the app ships so a casing slip or a theme dropping its terminal
// colours fails loudly here instead of silently rendering default xterm colours.
describe('ansiPalette', () => {
  const SLOTS = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
  ] as const

  it('fills all 16 ANSI slots from both bundled themes', () => {
    for (const theme of [githubDark, githubLight]) {
      const palette = ansiPalette(theme.colors ?? {}) as Record<string, string | undefined>
      for (const slot of SLOTS) expect(palette[slot], `${theme.name}:${slot}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('maps each slot to its terminal.ansi* key', () => {
    expect(ansiPalette({ 'terminal.ansiRed': '#111111', 'terminal.ansiBrightRed': '#222222' })).toMatchObject({
      red: '#111111',
      brightRed: '#222222',
    })
  })
})
