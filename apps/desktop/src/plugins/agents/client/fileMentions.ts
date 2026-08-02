import type { AgentInputPart } from '@acorn/protocol/managedAgents.ts'
import { fuzzyScore } from '../../../core/client/palette/model'

export type ActiveFileMention = {
  start: number
  end: number
  query: string
}

// Composer file mentions are deliberately conservative: a token must begin with @ at a word
// boundary, use a workspace-relative path, and may end in :line or :line-line. Email addresses,
// absolute paths and parent traversal remain ordinary text and are not promoted to provider files.
export function parseFileMentions(text: string): Extract<AgentInputPart, { type: 'file' }>[] {
  const output: Extract<AgentInputPart, { type: 'file' }>[] = []
  const seen = new Set<string>()
  const expression = /(?:^|\s)@(?:"((?:[^"\\]|\\.)+)"((?::\d+(?:-\d+)?)?)|([^\s]+))/g
  for (const match of text.matchAll(expression)) {
    const quotedPath = match[1]?.replace(/\\(["\\])/g, '$1')
    const token = quotedPath == null
      ? match[3].replace(/[),.;]+$/, '')
      : `${quotedPath}${match[2] ?? ''}`
    const lines = /:(\d+)(?:-(\d+))?$/.exec(token)
    const path = lines ? token.slice(0, lines.index) : token
    if (!path || path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) continue
    const key = `${path}:${lines?.[1] ?? ''}:${lines?.[2] ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      type: 'file',
      path,
      ...(lines ? { lineStart: Number(lines[1]), lineEnd: lines[2] ? Number(lines[2]) : undefined } : {}),
    })
  }
  return output
}

export function activeFileMention(text: string, cursor: number): ActiveFileMention | null {
  const before = text.slice(0, cursor)
  const match = /(?:^|\s)@(?:"([^"]*)|([^\s"]*))$/.exec(before)
  if (!match) return null
  const marker = match[0].lastIndexOf('@')
  const start = match.index + marker
  const suffix = /^[^\s]*/.exec(text.slice(cursor))?.[0] ?? ''
  return {
    start,
    end: cursor + suffix.length,
    query: match[1] ?? match[2] ?? '',
  }
}

export function formatFileMention(path: string): string {
  if (!/\s/.test(path)) return `@${path}`
  return `@"${path.replace(/(["\\])/g, '\\$1')}"`
}

export function completeFileMention(
  text: string,
  mention: ActiveFileMention,
  path: string,
): { text: string; cursor: number } {
  const hasFollowingSpace = /\s/.test(text[mention.end] ?? '')
  const replacement = `${formatFileMention(path)}${hasFollowingSpace ? '' : ' '}`
  const next = `${text.slice(0, mention.start)}${replacement}${text.slice(mention.end)}`
  return {
    text: next,
    cursor: mention.start + replacement.length + (hasFollowingSpace ? 1 : 0),
  }
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
