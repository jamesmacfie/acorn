import { createHighlighterCore, tokenizeAnsiWithTheme, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { loadGrammar } from './langs'

// THE MAIN-THREAD HIGHLIGHTER, AND IT IS NO LONGER THE ONE THAT DOES THE WORK. Diffs tokenize in
// highlighter.worker.ts, under the Oniguruma engine and off this thread. What is left here are the
// callers a worker would not pay for:
//
//   the terminal's ANSI palette   needs `getTheme()`, no grammar and no tokenizing at all
//   CI log output                 tokenizeAnsiLines — ANSI, also grammar-free
//   agent markdown code fences    small, already async, and it wants HTML rather than tokens
//
// plus the fallback path in ./worker.ts, for a window where the worker could not start.
//
// THE JAVASCRIPT REGEX ENGINE, NOT ONIGURUMA, AND THE RENDERER'S CSP IS WHY. Shiki's default engine
// compiles Oniguruma to WebAssembly, and `WebAssembly.instantiate` is gated by `script-src` — this
// document's is `'self'` with no `'wasm-unsafe-eval'` (main/appScheme.ts). So the default engine threw
// at startup and NOTHING was highlighted anywhere in the app: not a diff, not a code block, not an
// agent transcript. A silent failure, because the rejection lands in the highlighter's own promise.
//
// The engine measurably costs 4.6x on the same input, which is what the worker exists to recover
// WITHOUT widening this document's policy. It stays here because these callers are small and because a
// second engine on the main thread would be a second engine to keep working.
//
// `forgiving` covers the patterns a comparison could not reach: an unsupported regex is then skipped
// rather than thrown, because a highlighter that degrades beats one that takes its surface down.
const loaded = new Map<string, Promise<void>>()

let instance: Promise<HighlighterCore> | null = null

/**
 * The shared main-thread highlighter. Pass a grammar name to have it loaded first — grammars are lazy
 * (see langs.ts), so `codeToTokens`/`codeToHtml` on a language nobody asked for will throw otherwise.
 */
export async function getHighlighter(lang?: string): Promise<HighlighterCore> {
  const hl = await (instance ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }))
  if (lang && lang !== 'text') await loadGrammar(hl, loaded, lang)
  return hl
}

// The vocabulary lives in langs.ts now (the worker needs it too, and must not import this module).
// Re-exported because this is where every caller already looks for it.
export { langFor, LANGS } from './langs'

// ANSI-colour log lines (CI output), tokenized the same dual-theme way as diff code: {content,
// light, dark} per token, rendered with --l/--r CSS vars. ANSI token boundaries are theme-
// independent, so the two passes zip 1:1. `ansi` isn't a TextMate grammar — core won't route to it
// via codeToTokens, so we call tokenizeAnsiWithTheme directly, and no grammar has to be loaded.
export type AnsiTok = { content: string; light: string; dark: string }
export function tokenizeAnsiLines(hl: HighlighterCore, text: string): AnsiTok[][] {
  const light = tokenizeAnsiWithTheme(hl.getTheme('github-light'), text)
  const dark = tokenizeAnsiWithTheme(hl.getTheme('github-dark'), text)
  return light.map((line, i) => line.map((t, j) => ({ content: t.content, light: t.color ?? '', dark: dark[i]?.[j]?.color ?? '' })))
}
