import type { AgentInputPart } from '@acorn/protocol/managedAgents.ts'
import { fuzzyScore } from '@acorn/plugin-api/client'

export type ActiveFileMention = {
  start: number
  end: number
  query: string
}

// Composer file mentions are deliberately conservative: a token must begin with @ at a word
// boundary, use a workspace-relative path, and may end in :line or :line-line. Email addresses,
// absolute paths and parent traversal remain ordinary text and are not promoted to provider files.
//
// Yielded with offsets rather than returned as a list, because the composer's highlighter colours
// exactly the spans this promotes (composerTokens.ts). Two readings of "is that a file mention"
// would drift, and the visible one would start lying about what the turn actually sends.
export function* fileMentionMatches(
  text: string,
): Generator<Extract<AgentInputPart, { type: 'file' }> & { start: number; end: number }> {
  const expression = /(?:^|\s)@(?:"((?:[^"\\]|\\.)+)"((?::\d+(?:-\d+)?)?)|([^\s]+))/g
  for (const match of text.matchAll(expression)) {
    const quotedPath = match[1]?.replace(/\\(["\\])/g, '$1')
    const token = quotedPath == null
      ? match[3].replace(/[),.;]+$/, '')
      : `${quotedPath}${match[2] ?? ''}`
    const lines = /:(\d+)(?:-(\d+))?$/.exec(token)
    const path = lines ? token.slice(0, lines.index) : token
    if (!path || path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) continue
    // The leading space belongs to the sentence, not the mention. Trailing punctuation the loop
    // above trimmed is likewise left uncoloured, so `@a/b.ts,` highlights everything but the comma.
    const start = match.index + match[0].indexOf('@')
    const raw = quotedPath == null ? token : match[0].slice(match[0].indexOf('@') + 1)
    yield {
      type: 'file',
      path,
      ...(lines ? { lineStart: Number(lines[1]), lineEnd: lines[2] ? Number(lines[2]) : undefined } : {}),
      start,
      end: start + 1 + raw.length,
    }
  }
}

export function parseFileMentions(text: string): Extract<AgentInputPart, { type: 'file' }>[] {
  const output: Extract<AgentInputPart, { type: 'file' }>[] = []
  const seen = new Set<string>()
  for (const { start: _start, end: _end, ...mention } of fileMentionMatches(text)) {
    const key = `${mention.path}:${mention.lineStart ?? ''}:${mention.lineEnd ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(mention)
  }
  return output
}

/** The three things the composer completes. `@` reaches the worktree's files, `/` and `$` the
 * commands and skills the session advertises. */
export type MentionSigil = '@' | '/' | '$'

export type ActiveMention = ActiveFileMention & { sigil: MentionSigil }

/** The mention being typed at the caret, if the caret is in one. */
export function activeMention(text: string, cursor: number): ActiveMention | null {
  const before = text.slice(0, cursor)
  const match = /(?:^|\s)([@/$])(?:"([^"]*)|([^\s"]*))$/.exec(before)
  if (!match) return null
  const sigil = match[1] as MentionSigil
  const start = match.index + match[0].lastIndexOf(sigil)
  const suffix = /^[^\s]*/.exec(text.slice(cursor))?.[0] ?? ''
  return {
    sigil,
    start,
    end: cursor + suffix.length,
    query: match[2] ?? match[3] ?? '',
  }
}

export function activeFileMention(text: string, cursor: number): ActiveFileMention | null {
  const mention = activeMention(text, cursor)
  if (!mention || mention.sigil !== '@') return null
  const { sigil: _sigil, ...rest } = mention
  return rest
}

export function formatFileMention(path: string): string {
  if (!/\s/.test(path)) return `@${path}`
  return `@"${path.replace(/(["\\])/g, '\\$1')}"`
}

/** Swap the mention under the caret for a chosen one, landing the caret past the space that follows
 * it. One space, never two: a mention completed mid-sentence already has one. */
export function completeMention(
  text: string,
  mention: ActiveFileMention,
  replacement: string,
): { text: string; cursor: number } {
  const hasFollowingSpace = /\s/.test(text[mention.end] ?? '')
  const inserted = `${replacement}${hasFollowingSpace ? '' : ' '}`
  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`,
    cursor: mention.start + inserted.length + (hasFollowingSpace ? 1 : 0),
  }
}

export function completeFileMention(
  text: string,
  mention: ActiveFileMention,
  path: string,
): { text: string; cursor: number } {
  return completeMention(text, mention, formatFileMention(path))
}

export function fileMentionSuggestions(files: readonly string[], query: string, limit = 10): string[] {
  const normalized = query.trim()
  if (!normalized) return files.slice(0, limit)
  return files
    .map((path) => ({ path, score: fuzzyScore(normalized, path) }))
    .filter((item): item is { path: string; score: number } => item.score != null)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map((item) => item.path)
}
