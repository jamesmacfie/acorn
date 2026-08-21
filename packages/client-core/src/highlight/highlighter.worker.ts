// The syntax highlighter, off the main thread and behind its own Content-Security-Policy. See
// docs/diff-rendering.md § Syntax highlighting for why it needs to be a worker (the WASM engine
// versus the renderer's CSP) and why it takes a whole document rather than a line.
//
// `shiki/wasm` has to stay the inlined build: it is 622 KB of base64 inside the module, which is
// what lets this worker's policy keep `connect-src 'none'`. A non-inlined build fetches the
// .wasm at runtime and would need a network permission this worker is better off without.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { loadGrammar } from './langs'
import type { HighlightLines, HighlightRequest, HighlightResponse } from './protocol'

const THEMES = { light: 'github-light', dark: 'github-dark' } as const

const loaded = new Map<string, Promise<void>>()

let instance: Promise<HighlighterCore> | null = null
// No `langs` up front: docs/diff-rendering.md § Syntax highlighting covers the lazy-grammar reasoning.
const highlighter = () =>
  (instance ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  }))

/** A document with no grammar: one token per line, no colour. Same shape, so callers need no branch. */
const plain = (code: string): HighlightLines => code.split('\n').map((line) => [{ content: line, light: '', dark: '' }])

async function tokenize(lang: string, code: string): Promise<HighlightLines> {
  const hl = await highlighter()
  if (!(await loadGrammar(hl, loaded, lang))) return plain(code)
  // One call for the whole document: docs/diff-rendering.md § Syntax highlighting covers why that
  // is what lets Shiki thread grammar state from line to line correctly.
  const lines = hl.codeToTokensWithThemes(code, { lang: lang as never, themes: THEMES })
  return lines.map((line) => line.map((t) => ({ content: t.content, light: t.variants.light.color ?? '', dark: t.variants.dark.color ?? '' })))
}

const post = (message: HighlightResponse) => (self as unknown as Worker).postMessage(message)

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id, lang, code } = event.data
  void tokenize(lang, code).then(
    (lines) => post({ id, ok: true, lines }),
    // A grammar that fails to load or a pattern the engine rejects takes out one request, not the
    // worker: the client falls back to plain text for that document and the next one still tries.
    (error: unknown) => post({ id, ok: false, error: String((error as Error)?.message ?? error) }),
  )
}
