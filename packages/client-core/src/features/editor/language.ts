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
// The entries are thunks because a language pack builds a parser when it is called, and a document
// wants exactly one of them.
import { StreamLanguage } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { languageIdForPath, type LanguageId } from '@acorn/protocol/languageIds.ts'

const CODEMIRROR: Record<LanguageId, () => Extension> = {
  // No grammar is a real answer here, not a missing one: plain text highlights as plain text.
  plaintext: () => [],
  // One pack, four dialects, told apart by two flags rather than by four grammars.
  typescript: () => javascript({ typescript: true }),
  typescriptreact: () => javascript({ typescript: true, jsx: true }),
  javascript: () => javascript(),
  javascriptreact: () => javascript({ jsx: true }),
  json: () => json(),
  // CodeMirror ships one CSS grammar. SCSS and Less are supersets, so the shared parts highlight and
  // the dialect-only syntax falls through — a wrong-but-readable highlight, the same trade the
  // toml-as-ini line below makes.
  css: () => css(), scss: () => css(), less: () => css(),
  html: () => html(), xml: () => xml(),
  markdown: () => markdown(),
  python: () => python(),
  // The legacy stream modes: older, line-at-a-time grammars with no Lezer tree behind them. They
  // highlight, which is all either call site asks of them.
  ruby: () => StreamLanguage.define(ruby),
  go: () => go(), rust: () => rust(), java: () => java(),
  c: () => cpp(), cpp: () => cpp(),
  shellscript: () => StreamLanguage.define(shell),
  yaml: () => yaml(),
  sql: () => sql(),
  ini: () => StreamLanguage.define(properties), toml: () => StreamLanguage.define(toml),
}

export const languageFor = (id: LanguageId): Extension => CODEMIRROR[id]()

/** The path -> language shorthand both panes want. Kept here so a caller never re-derives the map. */
export const languageForPath = (path: string): Extension => languageFor(languageIdForPath(path))
