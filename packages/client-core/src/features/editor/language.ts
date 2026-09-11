// Canonical language id -> the CodeMirror extension that highlights it.
//
// One direction, one map, no abstraction layer (docs/editor.md § Naming: "neutral contract,
// un-neutral implementation"). The published vocabulary is @acorn/protocol/languageIds.ts; this is
// the half that knows what CodeMirror calls things, and the shiki half sits beside the highlighter.
//
// Exhaustive by type rather than by a fallback: a new entry in LANGUAGE_IDS fails `tsc` here until
// someone says what this engine should do with it, which is the whole reason to keep the map
// explicit instead of passing the canonical string through and hoping.
//
// The entries import their grammar and then build a parser from it, so a document downloads exactly
// one of them. They used to import all seventeen statically, which put every grammar in whichever
// chunk held this module: 954,915 bytes for a pane that opens one file
// (docs/performance.md § Registries hold loaders). The engine — `StreamLanguage` and
// the `Extension` type — stays static, because `basicSetup` has already brought it in wherever this
// is asked.
//
// The shiki half next door is already this shape (infra/highlight/langs.ts), and the two are worth
// reading together: one grammar per fence there, one grammar per file here.
import { StreamLanguage } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { languageIdForPath, type LanguageId } from '@acorn/protocol/languageIds.ts'

// CodeMirror keeps a syntax tree in the editor state. On WebKit a sufficiently large generated file
// can spend tens of seconds building that tree and eventually exhaust the JavaScript stack, blocking
// unrelated task and agent requests behind it. The document remains fully editable without a grammar,
// so large documents trade highlighting for a responsive window.
export const MAX_HIGHLIGHT_CHARACTERS = 256 * 1024

export const shouldHighlightDocument = (characters: number): boolean =>
  characters <= MAX_HIGHLIGHT_CHARACTERS

const CODEMIRROR: Record<LanguageId, () => Promise<Extension>> = {
  // No grammar is a real answer here, not a missing one: plain text highlights as plain text, and it
  // is the one entry that fetches nothing.
  plaintext: async () => [],
  // One pack, four dialects, told apart by two flags rather than by four grammars. All four resolve
  // the same import, so the second dialect a reader opens costs no request.
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  typescriptreact: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  javascriptreact: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  // CodeMirror ships one CSS grammar. SCSS and Less are supersets, so the shared parts highlight and
  // the dialect-only syntax falls through — a wrong-but-readable highlight, the same trade the
  // toml-as-ini line below makes.
  css: async () => (await import('@codemirror/lang-css')).css(),
  scss: async () => (await import('@codemirror/lang-css')).css(),
  less: async () => (await import('@codemirror/lang-css')).css(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  // The legacy stream modes: older, line-at-a-time grammars with no Lezer tree behind them. They
  // highlight, which is all either call site asks of them.
  ruby: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/ruby')).ruby),
  go: async () => (await import('@codemirror/lang-go')).go(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  shellscript: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  ini: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
  toml: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml),
}

/** The extension for one canonical language id. Async because the grammar arrives over the network:
 *  a caller that already awaits the file's text awaits both together. */
export const languageFor = (id: LanguageId): Promise<Extension> => CODEMIRROR[id]()

/** The path -> language shorthand both panes want. Kept here so a caller never re-derives the map. */
export const languageForPath = (path: string): Promise<Extension> => languageFor(languageIdForPath(path))
