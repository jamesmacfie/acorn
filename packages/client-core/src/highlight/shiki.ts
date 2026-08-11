import { createHighlighterCore, tokenizeAnsiWithTheme, type HighlighterCore, type LanguageInput } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { languageIdForPath, type LanguageId } from '@acorn/protocol/languageIds.ts'

// Fine-grained Shiki: only the langs/themes below get bundled (the bundled `shiki` entry pulls a
// chunk for every grammar). Dual github-light/dark so colours follow the app theme via CSS vars.
const LANGS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
}

// Canonical language id -> shiki grammar, the twin of client-core/editor/language.ts. The vocabulary
// itself is @acorn/protocol/languageIds.ts, and this map is where "shiki does not bundle that one"
// gets said: an id with no grammar loaded here falls to `text` rather than throwing inside
// codeToTokens. That is why the map is total over LanguageId instead of falling through — a new
// entry in the vocabulary fails `tsc` here until someone decides whether to pull its grammar in.
const SHIKI: Record<LanguageId, keyof typeof LANGS | 'text'> = {
  typescript: 'typescript', typescriptreact: 'tsx',
  javascript: 'javascript', javascriptreact: 'jsx',
  json: 'json', css: 'css', html: 'html', markdown: 'markdown',
  python: 'python', go: 'go', rust: 'rust', java: 'java',
  c: 'c', cpp: 'cpp',
  shellscript: 'shellscript', yaml: 'yaml', sql: 'sql',
  // No grammar bundled: plain text, which is what these already rendered as.
  plaintext: 'text', scss: 'text', less: 'text', xml: 'text', ruby: 'text', ini: 'text', toml: 'text',
}

export const langFor = (path: string) => SHIKI[languageIdForPath(path)]

let instance: Promise<HighlighterCore> | null = null
export const getHighlighter = () =>
  (instance ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: Object.values(LANGS).map((load) => load()) as LanguageInput[],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  }))

// ANSI-colour log lines (CI output), tokenized the same dual-theme way as diff code: {content,
// light, dark} per token, rendered with --l/--r CSS vars. ANSI token boundaries are theme-
// independent, so the two passes zip 1:1. `ansi` isn't a TextMate grammar — core won't route to it
// via codeToTokens, so we call tokenizeAnsiWithTheme directly.
export type AnsiTok = { content: string; light: string; dark: string }
export function tokenizeAnsiLines(hl: HighlighterCore, text: string): AnsiTok[][] {
  const light = tokenizeAnsiWithTheme(hl.getTheme('github-light'), text)
  const dark = tokenizeAnsiWithTheme(hl.getTheme('github-dark'), text)
  return light.map((line, i) => line.map((t, j) => ({ content: t.content, light: t.color ?? '', dark: dark[i]?.[j]?.color ?? '' })))
}
