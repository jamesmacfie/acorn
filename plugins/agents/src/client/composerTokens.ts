import { fuzzyScore } from '@acorn/plugin-api/client'
import { fileMentionMatches } from './fileMentions'

export type ComposerTokenKind = 'file' | 'command' | 'skill'

/** `name` is the token without its sigil, which is what a description is keyed by. */
export type ComposerToken = { kind: ComposerTokenKind; name: string; start: number; end: number }

export type ComposerSegment = { text: string; token: ComposerToken | null }

/** A command or skill as the session advertises it. */
export type AdvertisedItem = { name: string; description?: string }

/** Past this the composer stops colouring and shows plain text. A pasted stack trace is still a
 * draft someone has to be able to type into, and rebuilding the mirror on every keystroke is work
 * proportional to the whole draft. Nothing about a message this long is read as tokens anyway. */
export const MAX_HIGHLIGHT_LENGTH = 20_000

// `/name` and `$name` at a word boundary. The name charset admits `:` because a plugin-supplied
// skill is namespaced (`code-review:code-review`), and stops at whitespace so `/review the diff`
// colours the command and not the sentence after it.
const SIGIL = /(?:^|\s)([/$])([A-Za-z0-9][\w.:-]*)/g

/**
 * Every span the composer draws in the mention colour. Commands and skills are matched against what
 * the session actually advertises rather than by shape, so `9/11` and `and/or` stay prose and a
 * misremembered `/reviw` stays visibly uncoloured, which is the useful half of the feedback.
 *
 * File mentions come from `fileMentionMatches`, so what is coloured is exactly what the turn sends
 * as a file part.
 */
export function composerTokens(
  text: string,
  advertised: { commands?: readonly string[]; skills?: readonly string[] } = {},
): ComposerToken[] {
  if (!text || text.length > MAX_HIGHLIGHT_LENGTH) return []
  const commands = new Set(advertised.commands ?? [])
  const skills = new Set(advertised.skills ?? [])
  const tokens: ComposerToken[] = []

  for (const match of fileMentionMatches(text)) {
    tokens.push({ kind: 'file', name: match.path, start: match.start, end: match.end })
  }

  for (const match of text.matchAll(SIGIL)) {
    const [sigil, name] = [match[1], match[2]]
    const known = sigil === '/' ? commands.has(name) : skills.has(name)
    if (!known) continue
    const start = match.index + match[0].indexOf(sigil)
    tokens.push({
      kind: sigil === '/' ? 'command' : 'skill',
      name,
      start,
      end: start + 1 + name.length,
    })
  }

  return tokens.sort((left, right) => left.start - right.start)
}

/** The same text as a flat run of coloured and uncoloured pieces, ready to mirror behind the
 * textarea. Overlapping tokens cannot happen today, and if one ever did the later span is dropped
 * rather than allowed to reorder the text. */
export function composerSegments(
  text: string,
  advertised: { commands?: readonly string[]; skills?: readonly string[] } = {},
): ComposerSegment[] {
  const segments: ComposerSegment[] = []
  let cursor = 0
  for (const token of composerTokens(text, advertised)) {
    if (token.start < cursor) continue
    if (token.start > cursor) segments.push({ text: text.slice(cursor, token.start), token: null })
    segments.push({ text: text.slice(token.start, token.end), token })
    cursor = token.end
  }
  // The trailing newline is the mirror's, not the draft's: a textarea keeps a final empty line and a
  // <pre> collapses it, which drifts the two by one row for the rest of the message.
  segments.push({ text: `${text.slice(cursor)}\n`, token: null })
  return segments
}

/**
 * How far to scroll a suggestion list so the row the keyboard is on is fully inside it. Zero when
 * the row already fits, negative to reveal a row above, positive for one below.
 *
 * Edges rather than indexes and row heights, because a row is one or two lines depending on whether
 * the thing it names has a description, so the nth row is not at n times anything. Its own scrollTop
 * rather than `scrollIntoView`, which is free to scroll every ancestor as well and would drag the
 * transcript behind the composer.
 */
export function scrollDeltaFor(
  list: { top: number; bottom: number },
  row: { top: number; bottom: number },
): number {
  if (row.top < list.top) return row.top - list.top
  if (row.bottom > list.bottom) return row.bottom - list.bottom
  return 0
}

/**
 * Commands or skills worth offering for what has been typed after `/` or `$`. Ranked by the name,
 * because that is what is being typed, but a description match still qualifies: someone reaching for
 * the review command may type `/diff` before remembering what it is called.
 */
export function advertisedSuggestions(
  items: readonly AdvertisedItem[],
  query: string,
  limit = 10,
): AdvertisedItem[] {
  const normalized = query.trim()
  if (!normalized) return items.slice(0, limit)
  const lowered = normalized.toLowerCase()
  return items
    .map((item) => ({
      item,
      score: fuzzyScore(normalized, item.name)
        ?? (item.description?.toLowerCase().includes(lowered) ? 0 : null),
    }))
    .filter((ranked): ranked is { item: AdvertisedItem; score: number } => ranked.score != null)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
    .slice(0, limit)
    .map((ranked) => ranked.item)
}
