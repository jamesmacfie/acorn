// The pure half of `MentionTextarea`: what is being typed at the caret, what replacing it does to the
// text, and how far a suggestion list has to scroll to show the row the keyboard is on.
//
// Here rather than in a plugin because the field is the kit's. Two readings of "is the caret in a
// mention" — the one that opens the list and the one that colours the text — would drift, and the
// visible one would start lying about what the field will actually complete.

/** The character that opens a completion. `@` for a name or a path, `/` for a command, `$` for a
 *  skill: the field never assumes which, and takes the set from whoever declared the sources. */
export type MentionSigil = string

export type ActiveMention = {
  sigil: MentionSigil
  /** Where the sigil is, and where the token it opens ends. */
  start: number
  end: number
  /** What has been typed after the sigil. */
  query: string
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

/**
 * The mention being typed at the caret, if the caret is in one.
 *
 * A sigil only counts at a word boundary, so `a@b.com` is an address and `shipped 9/11` is a date.
 * A quoted token (`@"docs/product brief.md"`) keeps its spaces, which is why the two alternatives
 * differ on whether whitespace ends the query.
 */
export function activeMention(text: string, cursor: number, sigils: readonly string[]): ActiveMention | null {
  if (!sigils.length) return null
  const before = text.slice(0, cursor)
  const match = new RegExp(`(?:^|\\s)([${sigils.map(escape).join('')}])(?:"([^"]*)|([^\\s"]*))$`).exec(before)
  if (!match) return null
  const sigil = match[1]!
  const start = match.index + match[0].lastIndexOf(sigil)
  // Past the caret too: completing in the middle of a word replaces the whole word rather than
  // leaving its tail stranded after the inserted name.
  const suffix = /^[^\s]*/.exec(text.slice(cursor))?.[0] ?? ''
  return { sigil, start, end: cursor + suffix.length, query: match[2] ?? match[3] ?? '' }
}

/** Swap the mention under the caret for a chosen one, landing the caret past the space that follows
 *  it. One space, never two: a mention completed mid-sentence already has one. */
export function completeMention(
  text: string,
  mention: { start: number; end: number },
  replacement: string,
): { text: string; cursor: number } {
  const hasFollowingSpace = /\s/.test(text[mention.end] ?? '')
  const inserted = `${replacement}${hasFollowingSpace ? '' : ' '}`
  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`,
    cursor: mention.start + inserted.length + (hasFollowingSpace ? 1 : 0),
  }
}

/**
 * How far to scroll a suggestion list so the row the keyboard is on is fully inside it. Zero when
 * the row already fits, negative to reveal a row above, positive for one below.
 *
 * Edges rather than indexes and row heights, because a row is one or two lines depending on whether
 * the thing it names has a description, so the nth row is not at n times anything. Its own scrollTop
 * rather than `scrollIntoView`, which is free to scroll every ancestor as well and would drag the
 * surface behind the field.
 */
export function scrollDeltaFor(
  list: { top: number; bottom: number },
  row: { top: number; bottom: number },
): number {
  if (row.top < list.top) return row.top - list.top
  if (row.bottom > list.bottom) return row.bottom - list.bottom
  return 0
}
