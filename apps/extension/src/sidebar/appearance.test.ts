import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { STYLES, THEMES, followAppearance, saveAppearance } from './appearance'

// The sheets main.tsx loads, read as text: Vitest hands a stylesheet import back empty.
const sheet = (name: string) =>
  readFileSync(createRequire(import.meta.url).resolve(`@acorn/client-core/infra/styles/${name}`), 'utf8')
const blocks = (sheet: string, attribute: string) =>
  [...sheet.matchAll(new RegExp(`:root\\[${attribute}=["']([\\w-]+)["']\\]\\s*\\{`, 'g'))].map((match) => match[1])

describe('appearance', () => {
  it('offers exactly the themes and style packs the app stylesheets define', () => {
    // Light and Terminal are the plain :root defaults, with no block of their own.
    expect(['light', ...new Set(blocks(sheet('tokens-theme.css'), 'data-theme'))]).toEqual(THEMES.map(([id]) => id))
    expect([
      'terminal',
      ...['modern', 'cozy', 'cute'].flatMap((id) => blocks(sheet(`style-${id}.css`), 'data-style')),
    ]).toEqual(STYLES.map(([id]) => id))
  })

  it("gives each theme's swatch the background colour its stylesheet block sets", () => {
    const themes = sheet('tokens-theme.css')
    // Every `--name: value` in the plain :root blocks, for the `var()` a theme block points at.
    const rootBlocks = [...themes.matchAll(/^:root \{([^}]*)\}/gm)].map((match) => match[1]).join('')
    const rootValue = (name: string) => new RegExp(`(?<![\\w-])--${name}:\\s*([^;]+);`).exec(rootBlocks)?.[1]
    const background = (id: string) => {
      // Light is the plain :root default, with no block of its own.
      const block =
        id === 'light' ? rootBlocks : new RegExp(`:root\\[data-theme="${id}"\\] \\{([^}]*)\\}`).exec(themes)?.[1]
      const value = /(?<![\w-])--bg:\s*([^;]+);/.exec(block ?? '')?.[1]
      return value?.replace(/^var\(--([\w-]+)\)$/, (_, name: string) => rootValue(name)!)
    }
    for (const [id, , swatch] of THEMES) expect(background(id), id).toBe(swatch)
  })

  it('follows the system until a theme is chosen, and follows a choice made in another panel', async () => {
    const fake = fakeBrowser()
    const root = { dataset: {} as DOMStringMap }
    await followAppearance(fake.api, root)
    expect(root.dataset).toEqual({ style: 'terminal' })

    await saveAppearance(fake.api.storage.local, { theme: 'nord', style: 'cozy' })
    await settle()
    expect(root.dataset).toEqual({ theme: 'nord', style: 'cozy' })

    // A theme or pack this build doesn't know falls back rather than painting a half-applied theme.
    await fake.api.storage.local.set({ appearance: { theme: 'gone', style: 'gone' } })
    await settle()
    expect(root.dataset).toEqual({ style: 'terminal' })
  })
})
