// The language-id vocabulary, published once (docs/editor/document-surface.md § Naming).
//
// Three parties need the same words and no two share a package: the node parses a manifest that names
// one, the renderer maps it onto a CodeMirror language, and the diff highlighter maps it onto a shiki
// grammar.
//
// The spellings are LSP's. A vendor name in a manifest is a vendor name in the wire format permanently,
// and LSP is the established vendor-neutral spelling, so a terminal or mobile implementation has a map
// to follow and a second engine maps onto the same words rather than inventing a third set.
//
// Per-engine mapping isn't here. This package names no renderer, so `plaintext -> 'text'` for shiki and
// `shellscript -> 'shell'` for the editor live beside the engines that need them.

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

/** The one fallback for both engines. */
const DEFAULT_LANGUAGE_ID: LanguageId = 'plaintext'

const IDS: ReadonlySet<string> = new Set(LANGUAGE_IDS)

export const isLanguageId = (value: string): value is LanguageId => IDS.has(value)

// Extension to language. The vocabulary is what a document declares, and how far a given engine gets
// with it is that engine's business.
const EXTENSIONS: Record<string, LanguageId> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  sh: 'shellscript',
  bash: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  ini: 'ini',
  toml: 'toml',
}

/** By extension only. A dotless name such as `Makefile` gets the fallback. */
export const languageIdForPath = (path: string): LanguageId =>
  EXTENSIONS[path.split('.').pop()?.toLowerCase() ?? ''] ?? DEFAULT_LANGUAGE_ID
