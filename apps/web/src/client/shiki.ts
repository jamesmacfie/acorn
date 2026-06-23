import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

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

const EXT_LANG: Record<string, keyof typeof LANGS> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', html: 'html', md: 'markdown',
  py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  sh: 'shellscript', bash: 'shellscript', yml: 'yaml', yaml: 'yaml', sql: 'sql',
}

export const langFor = (path: string) => EXT_LANG[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'text'

let instance: Promise<HighlighterCore> | null = null
export const getHighlighter = () =>
  (instance ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: Object.values(LANGS).map((load) => load()) as LanguageInput[],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  }))
