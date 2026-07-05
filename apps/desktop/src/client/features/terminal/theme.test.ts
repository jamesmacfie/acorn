import { describe, expect, it } from 'vitest'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { ansiPalette, isDarkColor } from './theme'

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

// isAppDark judges the theme from the live --bg token; verify the classifier against the actual
// --bg of every theme in tokens-layout.css light/dark families.
describe('isDarkColor', () => {
  it('classifies the app themes correctly by their --bg', () => {
    for (const bg of ['#ffffff', '#fdf6e3', '#eff1f5']) expect(isDarkColor(bg), bg).toBe(false) // light, solarized-light, catppuccin-latte
    for (const bg of ['#121212', '#002b36', '#272822', '#2e3440', '#282a36', '#1e222a']) expect(isDarkColor(bg), bg).toBe(true) // dark, solarized-dark, monokai, nord, dracula, one-dark
  })
})
