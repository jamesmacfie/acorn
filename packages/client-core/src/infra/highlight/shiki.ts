import { measure } from '../telemetry/emitter'
import { createHighlighterCore, tokenizeAnsiWithTheme, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { keepAnsiColour } from '../../kit/lib/rendering/ansi'
import { fenceHtml } from './fenceHtml'
import { loadGrammar } from './langs'

// The main-thread highlighter, for the callers a worker would not pay for: the terminal's ANSI
// palette and CI log output. Diffs and markdown code fences highlight in highlighter.worker.ts under
// Oniguruma (docs/diff-rendering/loading.md § Syntax highlighting), and ./worker.ts falls back here
// when the worker cannot start.
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

/**
 * Render one fence on the main thread. The fallback for ./worker.ts's `highlightToHtml`, which asks the
 * worker first. It can reject, because a grammar that will not load is a rejected dynamic import, so a
 * caller catches and renders the fence plain. `isLive` is checked once the grammar has loaded: a fence
 * nobody waits for any more is not rendered.
 */
export async function renderFenceOnMainThread(code: string, lang: string, isLive: () => boolean): Promise<string> {
  const hl = await getHighlighter(lang)
  if (!isLive()) return ''
  return measure('core', 'highlight.html.render', () => fenceHtml(hl, code, lang))
}

// The vocabulary lives in langs.ts, because the worker needs it too and must not import this
// module. Re-exported because this is where callers look for it.
export { langFor, LANGS } from './langs'

// ANSI-colour log lines, tokenized the same dual-theme way as diff code: {content, light, dark} per
// token, rendered with the --l and --r CSS vars. ANSI token boundaries are theme-independent, so
// the two passes zip 1:1. `ansi` is not a TextMate grammar, so this calls tokenizeAnsiWithTheme
// directly and no grammar loads.
//
// A colour is empty where the output set none, so the text keeps its surface's own colour rather
// than the Shiki theme's. Every escape that is not a colour code goes first: Shiki leaves a charset
// select such as `ESC ( B` in the text, and an OSC hyperlink stops it parsing the rest of the line.
export type AnsiTok = {
  content: string
  light: string
  dark: string
  lightBg: string
  darkBg: string
  bold: boolean
  italic: boolean
  underline: boolean
}
// TextMate's FontStyle bits. Shiki types them as a const enum and exports no value for them.
const ITALIC = 1
const BOLD = 2
const UNDERLINE = 4
export function tokenizeAnsiLines(hl: HighlighterCore, text: string): AnsiTok[][] {
  const clean = keepAnsiColour(text)
  const [light, dark] = (['github-light', 'github-dark'] as const).map((name) => {
    const theme = hl.getTheme(name)
    return tokenizeAnsiWithTheme(theme, clean).map((line) =>
      line.map((t) => ({
        content: t.content,
        color: t.color === theme.fg ? '' : (t.color ?? ''),
        bg: t.bgColor ?? '',
        fontStyle: t.fontStyle ?? 0,
      })),
    )
  })
  return light.map((line, i) =>
    line.map((t, j) => {
      const other = dark[i]?.[j]
      return {
        content: t.content,
        light: t.color,
        dark: other?.color ?? '',
        lightBg: t.bg,
        darkBg: other?.bg ?? '',
        bold: (t.fontStyle & BOLD) !== 0,
        italic: (t.fontStyle & ITALIC) !== 0,
        underline: (t.fontStyle & UNDERLINE) !== 0,
      }
    }),
  )
}
