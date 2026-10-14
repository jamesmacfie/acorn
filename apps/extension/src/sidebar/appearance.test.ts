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
