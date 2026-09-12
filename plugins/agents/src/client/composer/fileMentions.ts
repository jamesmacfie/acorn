import type { AgentInputPart } from '@acorn/protocol/managedAgents.ts'
import { fuzzyScore } from '@acorn/plugin-api/client'

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

/** The mention text for a path: quoted when the path has a space in it, so completing one does not
 *  end the token halfway through. Paired with `fileMentionMatches` above, which has to be able to
 *  read back what this writes. */
export function formatFileMention(path: string): string {
  if (!/\s/.test(path)) return `@${path}`
  return `@"${path.replace(/(["\\])/g, '\\$1')}"`
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
