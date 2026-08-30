// Canonical language id -> Monaco language id.
//
// One direction, one map, no abstraction layer (docs/third-party/monaco.md § Naming: "neutral contract,
// un-neutral implementation"). The published vocabulary is @acorn/protocol/languageIds.ts; this is
// the half that knows what Monaco calls things, and the shiki half sits beside the highlighter.
//
// Exhaustive by type rather than by a fallback: a new entry in LANGUAGE_IDS fails `tsc` here until
// someone says what Monaco should do with it, which is the whole reason to keep the map explicit
// instead of passing the canonical string through and hoping.
import { languageIdForPath, type LanguageId } from '@acorn/protocol/languageIds.ts'

const MONACO: Record<LanguageId, string> = {
  plaintext: 'plaintext',
  // Monaco's TypeScript mode handles both flavours; the grammar difference is shiki's problem.
  typescript: 'typescript', typescriptreact: 'typescript',
  javascript: 'javascript', javascriptreact: 'javascript',
  json: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml',
  markdown: 'markdown',
  python: 'python', ruby: 'ruby', go: 'go', rust: 'rust', java: 'java',
  c: 'c', cpp: 'cpp',
  shellscript: 'shell',
  yaml: 'yaml',
  sql: 'sql',
  // Monaco has no TOML mode. `ini` is close enough to be useful and is what the editor pane already
  // did for `.toml`; a wrong-but-readable highlight beats an unregistered id, which renders as plain.
  ini: 'ini', toml: 'ini',
}

export const monacoLanguageFor = (id: LanguageId): string => MONACO[id]

/** The path -> Monaco shorthand both panes want. Kept here so a caller never re-derives the map. */
export const monacoLanguageForPath = (path: string): string => monacoLanguageFor(languageIdForPath(path))
