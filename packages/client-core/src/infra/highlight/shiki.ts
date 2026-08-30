import { createHighlighterCore, tokenizeAnsiWithTheme, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { loadGrammar } from './langs'

// The main-thread highlighter, for the callers a worker would not pay for: the terminal's ANSI
// palette, CI log output, and agent markdown code fences. Diffs tokenize in
// highlighter.worker.ts under Oniguruma (docs/diff-rendering.md § Syntax highlighting), and
// ./worker.ts falls back here when the worker cannot start.
//
// The engine is JavaScript regex rather than Oniguruma, which is what the renderer's CSP allows.
// `forgiving` skips an unsupported regex rather than throwing, because a highlighter that degrades
// beats one that takes its surface down.
const loaded = new Map<string, Promise<void>>()

let instance: Promise<HighlighterCore> | null = null

/**
 * The shared main-thread highlighter. Pass a grammar name to have it loaded first: grammars are lazy
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

// The vocabulary lives in langs.ts, because the worker needs it too and must not import this
// module. Re-exported because this is where callers look for it.
export { langFor, LANGS } from './langs'

// ANSI-colour log lines, tokenized the same dual-theme way as diff code: {content, light, dark} per
// token, rendered with the --l and --r CSS vars. ANSI token boundaries are theme-independent, so
// the two passes zip 1:1. `ansi` is not a TextMate grammar, so this calls tokenizeAnsiWithTheme
// directly and no grammar loads.
export type AnsiTok = { content: string; light: string; dark: string }
export function tokenizeAnsiLines(hl: HighlighterCore, text: string): AnsiTok[][] {
  const light = tokenizeAnsiWithTheme(hl.getTheme('github-light'), text)
  const dark = tokenizeAnsiWithTheme(hl.getTheme('github-dark'), text)
  return light.map((line, i) => line.map((t, j) => ({ content: t.content, light: t.color ?? '', dark: dark[i]?.[j]?.color ?? '' })))
}
