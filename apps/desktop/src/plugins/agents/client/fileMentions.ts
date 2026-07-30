import type { AgentInputPart } from '../../../core/shared/managedAgents'

// Composer file mentions are deliberately conservative: a token must begin with @ at a word
// boundary, use a workspace-relative path, and may end in :line or :line-line. Email addresses,
// absolute paths and parent traversal remain ordinary text and are not promoted to provider files.
export function parseFileMentions(text: string): Extract<AgentInputPart, { type: 'file' }>[] {
  const output: Extract<AgentInputPart, { type: 'file' }>[] = []
  const seen = new Set<string>()
  const expression = /(?:^|\s)@([^\s]+)/g
  for (const match of text.matchAll(expression)) {
    const token = match[1].replace(/[),.;]+$/, '')
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
