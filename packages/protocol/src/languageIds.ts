// The language-id vocabulary, published once (docs/third-party/monaco.md § Naming).
//
// Three parties need the same words and no two share a package: the node parses a manifest that names
// one, the renderer maps it onto a Monaco language, and the diff highlighter maps it onto a shiki
// grammar. Before this file there were two maps with two vocabularies and two different fallbacks,
// `plaintext` in the editor pane and `text` in the highlighter.
//
// The spellings are LSP's. A vendor name in a manifest is a vendor name in the wire format permanently,
// and LSP is the established vendor-neutral spelling, so a terminal or mobile implementation has a map
// to follow and a second engine maps onto the same words rather than inventing a third set.
//
// Per-engine mapping isn't here. This package names no renderer, so `plaintext -> 'text'` for shiki and
// `shellscript -> 'shell'` for Monaco live beside the engines that need them.

export const LANGUAGE_IDS = [
  'plaintext',
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'json',
  'css',
  'scss',
  'less',
  'html',
  'xml',
  'markdown',
  'python',
  'ruby',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'shellscript',
  'yaml',
  'sql',
  'ini',
  'toml',
] as const

export type LanguageId = (typeof LANGUAGE_IDS)[number]

/** The fallback, and the only one. Both engines had their own before this file existed. */
export const DEFAULT_LANGUAGE_ID: LanguageId = 'plaintext'

const IDS: ReadonlySet<string> = new Set(LANGUAGE_IDS)

export const isLanguageId = (value: string): value is LanguageId => IDS.has(value)

// Extension to language. The union of the two maps this replaces, which is why it carries entries
// neither engine can render (a `.rb` file highlights as plaintext under shiki): the vocabulary is what a
// document declares, and how far a given engine gets with it is that engine's business.
const EXTENSIONS: Record<string, LanguageId> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml',
  md: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  sh: 'shellscript', bash: 'shellscript',
  yml: 'yaml', yaml: 'yaml',
  sql: 'sql',
  ini: 'ini', toml: 'toml',
}

/** By extension only. A dotless name such as `Makefile` gets the fallback, which is the behaviour both
 * maps already had. */
export const languageIdForPath = (path: string): LanguageId =>
  EXTENSIONS[path.split('.').pop()?.toLowerCase() ?? ''] ?? DEFAULT_LANGUAGE_ID
