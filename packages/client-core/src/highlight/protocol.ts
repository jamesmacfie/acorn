// The highlight worker's wire format. Its own module, importing nothing, because both sides of a
// worker boundary need these words and neither may pull the other's graph across: the worker must not
// reach ui/diff/model.ts (that would drag `diff` and `gitdiff-parser` into the worker bundle), and the
// client must not reach the worker's shiki imports (that would put the WASM engine back on the main
// thread, which is the whole thing this exists to avoid).
//
// The token shape is deliberately structural rather than an import of ui/diff/model.ts's `Tok`. They
// are the same three fields and stay assignable; what is NOT wanted is a highlight module that only
// compiles because a diff module exists.

/** One highlighted run: its text, and the colour it takes under each of the two bundled themes. */
export type HighlightTok = { content: string; light: string; dark: string }

/** Tokens for a whole document, outer array per line. Empty inner array = a blank line. */
export type HighlightLines = HighlightTok[][]

export type HighlightRequest = {
  id: number
  /** A shiki grammar name (highlight/shiki.ts § SHIKI), already resolved from the path by the caller. */
  lang: string
  /** A whole document, newline-separated. NEVER a single line — see the client's comment on why. */
  code: string
}

export type HighlightResponse = { id: number; ok: true; lines: HighlightLines } | { id: number; ok: false; error: string }
