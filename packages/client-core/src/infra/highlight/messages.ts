// The highlight worker's wire format. Its own module, importing nothing: see
// docs/diff-rendering.md § Syntax highlighting for why neither side of the worker boundary may
// pull the other's graph across.
//
// The token shape is structural rather than an import of ui/diff/model.ts's `Tok`. They are the
// same three fields and stay assignable; what is not wanted is a highlight module that only
// compiles because a diff module exists.

/** One highlighted run: its text, and the colour it takes under each of the two bundled themes. */
export type HighlightTok = { content: string; light: string; dark: string }

/** Tokens for a whole document, outer array per line. Empty inner array = a blank line. */
export type HighlightLines = HighlightTok[][]

export type HighlightRequest = {
  id: number
  /** A shiki grammar name (highlight/shiki.ts), already resolved from the path by the caller. */
  lang: string
  /** A whole document, newline-separated, never a single line: see worker.ts for why. */
  code: string
}

export type HighlightResponse = { id: number; ok: true; lines: HighlightLines } | { id: number; ok: false; error: string }
