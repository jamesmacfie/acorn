import { afterEach, describe, expect, it } from 'vitest'
import { THEME_PALETTE_TOKENS } from '@acorn/protocol/themeTokens.ts'
import type { PluginThemeDescriptor } from '@acorn/protocol/pluginContract.ts'
import { themeRegistry } from '../../registries/themes'
import { resolveTheme, THEMES } from '../../settings/themes'
import { pluginThemeBlock, pluginThemeId, pluginThemeStyleSheet, registerPluginTheme } from './themes'

// The one place in the client where a string that came out of a manifest is concatenated into CSS.
// Everything below is about that: what the host will write, what it refuses to write, and what
// happens to a person's stored preference when the plugin that owned their theme goes away.

const tokens = (over: Record<string, string> = {}): Record<string, string> =>
  ({ ...Object.fromEntries(THEME_PALETTE_TOKENS.map((name) => [name, '#123456'])), ...over })

const theme = (over: Partial<PluginThemeDescriptor> = {}): PluginThemeDescriptor => ({
  id: 'nightfall',
  label: 'Nightfall',
  dark: true,
  tokens: tokens(),
  ...over,
})

const disposables: { dispose(): void }[] = []
const register = (pluginId: string, descriptor: PluginThemeDescriptor) => {
  const entry = registerPluginTheme(pluginId, descriptor)
  disposables.push(entry)
  return entry
}

afterEach(() => {
  while (disposables.length) disposables.pop()!.dispose()
})

describe('generating a theme block', () => {
  it('writes every palette token and the self-description a dark theme implies', () => {
    const css = pluginThemeBlock('plugin:board:nightfall', theme())
    expect(css.startsWith(':root[data-theme="plugin:board:nightfall"] {')).toBe(true)
    for (const name of THEME_PALETTE_TOKENS) expect(css).toContain(`  ${name}: #123456;`)
    expect(css).toContain('--is-dark: 1;  --color-scheme: dark;  --syntax-fg: var(--r);')
    // One block, closed once. A generator that emitted two would mean a value had closed one early.
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css.match(/\}/g)).toHaveLength(1)
  })

  it('writes the light self-description for a theme that does not claim to be dark', () => {
    // Not left to the cascade, deliberately: the pre-JS `:root:not([data-theme="light"])` block sets
    // --is-dark: 1 under an OS dark preference at the same specificity, so a light plugin theme that
    // said nothing would render a light palette while telling the terminal and the diff it was dark.
    const css = pluginThemeBlock('plugin:board:day', theme({ id: 'day', dark: false }))
    expect(css).toContain('--is-dark: 0;  --color-scheme: light;  --syntax-fg: var(--l);')
  })

  it('accepts the colour spellings a theme author actually reaches for', () => {
    const css = pluginThemeBlock('plugin:board:mixed', theme({
      tokens: tokens({
        '--bg': '#fff',
        '--bg-subtle': '#ffffffcc',
        '--shadow-popover': 'rgba(0, 0, 0, 0.42)',
        '--accent': 'oklch(0.7 0.15 250)',
        '--focus': 'hsl(210 100% 50%)',
      }),
    }))
    expect(css).toContain('--accent: oklch(0.7 0.15 250);')
    expect(css).toContain('--shadow-popover: rgba(0, 0, 0, 0.42);')
  })

  it('refuses a map that is missing a palette token', () => {
    const partial = tokens()
    delete partial['--hunk-text']
    expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: partial })))
      .toThrow(/no usable colour for --hunk-text/)
  })

  it('refuses an unknown token name', () => {
    expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ '--totally-made-up': '#fff' }) })))
      .toThrow(/may not set: --totally-made-up/)
  })

  it('refuses a DERIVED token, because restating one breaks the var() it exists for', () => {
    // --danger is `var(--del-marker)` on :root. A theme block that set it would keep its own value
    // while every other theme kept following the palette, which is the whole point of the split.
    expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ '--danger': '#ff0000' }) })))
      .toThrow(/may not set: --danger/)
    expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ '--surface-sunken': '#111' }) })))
      .toThrow(/may not set: --surface-sunken/)
  })

  it('refuses a style-axis token, so a theme can never touch shape or density', () => {
    expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ '--radius': '0' }) })))
      .toThrow(/may not set: --radius/)
  })

  it('refuses the three self-description tokens: a theme states `dark`, the host states the rest', () => {
    for (const name of ['--is-dark', '--color-scheme', '--syntax-fg']) {
      expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ [name]: '1' }) })), name)
        .toThrow(/may not set/)
    }
  })

  it('refuses a value that is not a colour', () => {
    for (const value of ['red', 'inherit', 'currentColor', 'var(--bg)', '', '  #fff  ']) {
      expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ '--bg': value }) })), value)
        .toThrow(/no usable colour for --bg/)
    }
  })
})

describe('a hostile theme cannot escape the block it is written into', () => {
  // The single real attack surface in this feature. Each value below is a way out of a CSS
  // declaration; none of them may reach the stylesheet, and the check is that generation throws
  // rather than that the output is escaped: an escaper is a thing that can be subtly wrong.
  const escapes = [
    '#fff; } :root { --bg: red',
    '#fff }',
    'url(https://evil.example/x)',
    'expression(alert(1))',
    '#fff;background:url(//evil)',
    '</style><script>alert(1)</script>',
    '#fff\n}\n:root{--text:red',
    'image-set("a.png")',
    'rgb(0,0,0)/*',
    "#fff'",
    '#fff"',
  ]

  it.each(escapes)('refuses %j as a token value', (value) => {
    expect(() => pluginThemeBlock('plugin:board:x', theme({ tokens: tokens({ '--bg': value }) }))).toThrow()
  })

  it('refuses a theme id that is not a safe selector value', () => {
    // The id lands inside the attribute selector's quotes. The manifest schema bounds its alphabet,
    // but a roster row is bytes a node sent, so the composed id is checked again right here.
    for (const id of ['x"] { color: red } :root[data-theme="y', 'x y', 'x}', 'X', '']) {
      expect(() => pluginThemeBlock(pluginThemeId('board', id), theme({ id })), id).toThrow(/safe selector/)
    }
  })

  it('never lets a refused theme reach the stylesheet', () => {
    expect(() => register('board', theme({ tokens: tokens({ '--bg': '#fff } :root { --bg: red' }) }))).toThrow()
    expect(pluginThemeStyleSheet()).toBe('')
    expect(THEMES().some(([id]) => id.startsWith('plugin:'))).toBe(false)
  })
})

describe('registering one', () => {
  it('namespaces the id, labels it with its owner, and installs exactly one block', () => {
    register('board', theme())
    expect(themeRegistry.get('plugin:board:nightfall')?.label).toBe('Nightfall (board)')
    expect(THEMES()).toContainEqual(['plugin:board:nightfall', 'Nightfall (board)'])
    expect(pluginThemeStyleSheet()).toContain(':root[data-theme="plugin:board:nightfall"] {')
  })

  it("keeps two plugins' identically named themes apart", () => {
    register('board', theme())
    register('other', theme())
    expect(THEMES().filter(([id]) => id.startsWith('plugin:')).map(([id]) => id))
      .toEqual(['plugin:board:nightfall', 'plugin:other:nightfall'])
  })

  it('takes the generated CSS with it on dispose', () => {
    const entry = register('board', theme())
    expect(pluginThemeStyleSheet()).not.toBe('')
    entry.dispose()
    expect(pluginThemeStyleSheet()).toBe('')
    expect(themeRegistry.get('plugin:board:nightfall')).toBeUndefined()
  })
})

describe('a stored preference outliving its plugin', () => {
  it('applies the plugin theme while it is registered', () => {
    register('board', theme())
    expect(resolveTheme('plugin:board:nightfall', 'dark')).toBe('plugin:board:nightfall')
  })

  it('falls back to the built-in default once the owner is gone, without touching the pref', () => {
    // Disabled, uninstalled, its bundle no longer trusted, or its node unreachable. All of them
    // reach this function as the same absence, which is exactly why the fallback is a read and the
    // stored value is left alone: the pref has to survive a node having a bad minute.
    const entry = register('board', theme())
    entry.dispose()
    expect(resolveTheme('plugin:board:nightfall', 'dark')).toBe('dark')
  })

  it('comes back when the plugin does', () => {
    const entry = register('board', theme())
    entry.dispose()
    expect(resolveTheme('plugin:board:nightfall', 'light')).toBe('light')
    register('board', theme())
    expect(resolveTheme('plugin:board:nightfall', 'light')).toBe('plugin:board:nightfall')
  })

  it('falls back for a built-in id that no longer exists, and never for one that does', () => {
    expect(resolveTheme('retired-theme', 'light')).toBe('light')
    expect(resolveTheme('dracula', 'light')).toBe('dracula')
    expect(resolveTheme(undefined, 'dark')).toBe('dark')
  })
})
