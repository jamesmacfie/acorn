// The syntax highlighter, off the main thread and behind its own Content-Security-Policy.
//
// TWO PROBLEMS, ONE MOVE, and neither is obvious from the code below.
//
// 1. THE ENGINE. Shiki's fast path compiles Oniguruma to WebAssembly, and `WebAssembly.instantiate` is
//    gated by `script-src`. The renderer's policy is `'self'` with no `'wasm-unsafe-eval'`
//    (main/appScheme.ts), so the WASM engine threw at startup and the app fell back to shiki's
//    JavaScript regex engine — measured at 4.6x slower on the same input.
//
//    A worker fixes this WITHOUT widening the document's policy, because a dedicated worker loaded
//    from a same-origin URL takes its CSP from that script's own response headers rather than
//    inheriting the document's. appScheme.ts serves this file, and only this file, with
//    `wasm-unsafe-eval` added. Verified three ways: the document still cannot instantiate WASM, this
//    worker can, and the same bytes served with the document's header cannot.
//
//    The policy this file is served under is also STRICTER than the renderer's in every other
//    direction — `default-src 'none'`, `connect-src 'none'`. There is no DOM here, no bridge to main,
//    and no network. It takes strings and returns colours.
//
// 2. THE MAIN THREAD. Tokenizing a 45-file diff was ~2s of main-thread work, in unbroken per-file
//    blocks of up to 325ms. Correct or not, that belongs off the thread that has to draw.
//
// `shiki/wasm` MUST STAY THE INLINED BUILD. It is 622 KB of base64 inside the module, which is what
// lets the policy above keep `connect-src 'none'` — a non-inlined build fetches the .wasm at runtime
// and would need a network permission this worker is much better off without.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { loadGrammar } from './langs'
import type { HighlightLines, HighlightRequest, HighlightResponse } from './protocol'

const THEMES = { light: 'github-light', dark: 'github-dark' } as const

const loaded = new Map<string, Promise<void>>()

let instance: Promise<HighlighterCore> | null = null
// No `langs` up front. Grammars are ~1.7 MB across the set and a given diff touches two or three of
// them; loading on first use keeps a TypeScript-only PR from paying for the C++ grammar (419 KB, the
// largest single one).
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
  // ONE CALL FOR THE WHOLE DOCUMENT, which is the point. Shiki threads grammar state line to line
  // internally, so a block comment, a template literal or a docstring spanning lines is coloured
  // correctly — the per-line calls this replaces started every line from a cold grammar state and got
  // all three wrong.
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
