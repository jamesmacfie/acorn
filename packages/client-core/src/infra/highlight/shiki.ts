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

// A fence's highlighted html, keyed by its language and its exact text.
//
// The transcript re-renders a streaming message about 25 times a second, and a message can hold
// several code fences. Block-level reuse in kit Markdown.tsx already stops an unchanged fence from
// being re-tokenized while the message is on screen; this catches the rest — the same fence coming
// back after a scroll, a view switch or a remount, and the same snippet appearing twice.
//
// Exact keys rather than a hash, because a hash collision would show a reader the wrong code. The
// ceiling that buys is memory, so the window is small and a fence over 16 KB is not kept at all: the
// cache is a window over what is on screen, not a record. If a surface ever needs a bigger one, hash
// the text and accept the collision risk, or move the store off the module.
const HTML_CACHE_ENTRIES = 200
const HTML_CACHE_MAX_BYTES = 16 * 1024
const htmlCache = new Map<string, string>()

/**
 * Highlight one whole fence to html, dual-themed, loading its grammar first. It can reject — a grammar
 * that will not load is a rejected dynamic import — so a caller catches and renders the fence plain.
 *
 * Each token carries both colours as --l/--r and the stylesheet picks a side with light-dark(), the
 * same way diff rows do (styles/primitives.css § Markdown, docs/ui-design.md § Token axes). Shiki's
 * own dual-theme default instead writes the light colour into `color` and the dark one into a
 * --shiki-dark no stylesheet here reads, so under a dark theme every fence drew github-light on a
 * white background.
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const key = `${lang}\u0000${code}`
  const hit = htmlCache.get(key)
  if (hit !== undefined) return hit
  const hl = await getHighlighter(lang)
  const html = hl.codeToHtml(code, {
    lang,
    themes: { l: 'github-light', r: 'github-dark' },
    defaultColor: false,
    cssVariablePrefix: '--',
  })
  if (code.length > HTML_CACHE_MAX_BYTES) return html
  // First in, first out. A Map iterates in insertion order, so the oldest key is the first one.
  if (htmlCache.size >= HTML_CACHE_ENTRIES) {
    const oldest = htmlCache.keys().next()
    if (!oldest.done) htmlCache.delete(oldest.value)
  }
  htmlCache.set(key, html)
  return html
}

/** Tests only: forget what has been highlighted so a spy can count calls from a known state. */
export const resetHighlightHtmlCache = (): void => htmlCache.clear()

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
