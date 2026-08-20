// The grammar vocabulary, split out of shiki.ts because two bundles need it and only one may have an
// engine in it: highlighter.worker.ts loads grammars under Oniguruma, shiki.ts loads them under the
// JavaScript engine, and a worker importing shiki.ts would drag the second engine across the boundary
// the worker exists to create.
import { languageIdForPath, type LanguageId } from '@acorn/protocol/languageIds.ts'

// Fine-grained: only the grammars named here can ever be bundled, because the bundled `shiki` entry
// pulls a chunk for every grammar in existence. These load lazily (see loadGrammar), so naming one costs
// nothing until a file of that language is rendered. That's what makes the list cheap to extend, and why
// scss, less, xml, ruby, ini and toml are on it: each was in the vocabulary, mapped to `text`, and
// rendered plain only because of the eager-load cost that used to apply to all of them at once.
export const LANGS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
}

export type GrammarName = keyof typeof LANGS

// Canonical language id to shiki grammar, the twin of client-core/editor/language.ts. The vocabulary is
// @acorn/protocol/languageIds.ts, and this map is where "shiki doesn't bundle that one" gets said: an id
// with no grammar loaded here falls to `text` rather than throwing inside codeToTokens.
//
// Total over LanguageId rather than falling through, so a new entry in the vocabulary fails `tsc` here
// until someone decides whether to pull its grammar in. Every id has a grammar now, and `plaintext` maps
// to `text` because that is the decision for plain text, not a gap.
const SHIKI: Record<LanguageId, GrammarName | 'text'> = {
  typescript: 'typescript', typescriptreact: 'tsx',
  javascript: 'javascript', javascriptreact: 'jsx',
  json: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml', markdown: 'markdown',
  python: 'python', ruby: 'ruby', go: 'go', rust: 'rust', java: 'java',
  c: 'c', cpp: 'cpp',
  shellscript: 'shellscript', yaml: 'yaml', sql: 'sql', ini: 'ini', toml: 'toml',
  plaintext: 'text',
}

export const langFor = (path: string): GrammarName | 'text' => SHIKI[languageIdForPath(path)]

export const isGrammar = (lang: string): lang is GrammarName => lang in LANGS

/**
/**
 * Load one grammar into a highlighter, at most once per name. Callers pass their own `loaded` set so the
 * worker and main-thread highlighters keep separate ledgers: they're separate instances, and a grammar
 * loaded into one isn't loaded into the other.
 */
export async function loadGrammar(
  hl: { loadLanguage: (lang: never) => Promise<void> },
  loaded: Map<string, Promise<void>>,
  lang: string,
): Promise<boolean> {
  if (!isGrammar(lang)) return false
  let pending = loaded.get(lang)
  if (!pending) {
    pending = LANGS[lang]!().then((mod) => hl.loadLanguage(mod as never))
    loaded.set(lang, pending)
  }
  await pending
  return true
}
