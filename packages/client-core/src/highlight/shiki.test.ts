import { describe, expect, it } from 'vitest'
import { getHighlighter, LANGS, langFor } from './shiki'

describe('langFor', () => {
  it('maps known extensions to their shiki language id', () => {
    expect(langFor('src/index.ts')).toBe('typescript')
    expect(langFor('App.tsx')).toBe('tsx')
    expect(langFor('a.mts')).toBe('typescript')
    expect(langFor('a.cts')).toBe('typescript')
    expect(langFor('main.js')).toBe('javascript')
    expect(langFor('a.mjs')).toBe('javascript')
    expect(langFor('a.cjs')).toBe('javascript')
    expect(langFor('Comp.jsx')).toBe('jsx')
    expect(langFor('package.json')).toBe('json')
    expect(langFor('script.py')).toBe('python')
    expect(langFor('server.go')).toBe('go')
    expect(langFor('lib.rs')).toBe('rust')
  })

  it('is case-insensitive on the extension', () => {
    expect(langFor('README.MD')).toBe('markdown')
    expect(langFor('Main.PY')).toBe('python')
  })

  it('keys on the last segment when there are multiple dots', () => {
    expect(langFor('a.test.ts')).toBe('typescript')
    expect(langFor('styles.module.css')).toBe('css')
  })

  it('maps the six that used to render plain despite being in the vocabulary', () => {
    // These were `text` only because every grammar loaded eagerly and six more was a cost nobody
    // wanted to pay up front. Grammars are lazy now, so the cost is zero until one is opened.
    expect(langFor('theme.scss')).toBe('scss')
    expect(langFor('theme.less')).toBe('less')
    expect(langFor('pom.xml')).toBe('xml')
    expect(langFor('app.rb')).toBe('ruby')
    expect(langFor('setup.ini')).toBe('ini')
    expect(langFor('Cargo.toml')).toBe('toml')
  })

  it("falls back to 'text' for unknown or missing extensions", () => {
    expect(langFor('notes.xyz')).toBe('text')
    expect(langFor('Makefile')).toBe('text') // no dot → no extension
    expect(langFor('')).toBe('text')
  })
})

// The engine, not the mapping. Nothing here can see the renderer's CSP — node runs WebAssembly
// happily, which is exactly why the Oniguruma failure was invisible until it reached a window — so
// what this pins is the half a test CAN see: every grammar this build bundles loads under the engine
// this build chose, and colour comes out the far end.
//
// This is the MAIN-THREAD highlighter, which is now the fallback rather than the path: diffs tokenize
// in highlighter.worker.ts under Oniguruma, and no node-environment test can reach a Worker.
describe('the highlighter itself', () => {
  it('builds and tokenizes with colour once its grammar is asked for', async () => {
    // The argument is the point: grammars load on demand now (langs.ts), so a caller that does not
    // name one gets a highlighter with none loaded and `codeToTokens` has nothing to route to.
    const highlighter = await getHighlighter('typescript')
    // `codeToTokensWithThemes`, because that is the call the renderer makes: both themes at once, one
    // token list, a colour per side.
    const [line] = highlighter.codeToTokensWithThemes('export const a: number = 1', {
      lang: 'typescript',
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    expect((line ?? []).some((token) => token.variants.light.color && token.variants.dark.color)).toBe(true)
  })

  it('loads every grammar the build names, under the engine the build chose', async () => {
    for (const grammar of Object.keys(LANGS)) {
      const highlighter = await getHighlighter(grammar)
      expect(highlighter.getLoadedLanguages()).toContain(grammar)
    }
  })
})
