import type { AgentInputPart } from '@acorn/protocol/managedAgents.ts'

export const DEFAULT_SESSION_TITLE = 'New agent session'
export const SESSION_TITLE_SYSTEM_PROMPT = `Generate a title that helps the user recognize this coding session later.

Identify the durable subject and the outcome the user wants. Ignore instructions about how the
agent should work, including models, tools, subagents, plans, reports, tests, commits, branches,
pull requests, monitoring, and output formats unless one of those is the subject.

Return one plain-text title and nothing else.
- Use 3-8 words.
- Use fewer than 50 characters.
- Prefer a compact noun phrase or a clear action phrase.
- Do not claim the work is complete.
- Do not copy and truncate the prompt.
- Do not add quotes, Markdown, labels, or trailing punctuation.`

const MAX_GENERATION_CHARS = 8_000
const GENERATION_TAIL_CHARS = 2_000
const OMITTED_MARKER = '\n[middle omitted]\n'

const normalizedWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ')

export const generationText = (parts: readonly AgentInputPart[]): string =>
  parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim()

export const isSessionTitlePromptEligible = (text: string): boolean =>
  normalizedWhitespace(text).split(' ').filter(Boolean).length >= 5

export const boundSessionTitlePrompt = (text: string): string => {
  if (text.length <= MAX_GENERATION_CHARS) return text
  const headChars = MAX_GENERATION_CHARS - GENERATION_TAIL_CHARS - OMITTED_MARKER.length
  return `${text.slice(0, headChars)}${OMITTED_MARKER}${text.slice(-GENERATION_TAIL_CHARS)}`
}

export const buildSessionTitlePrompt = (text: string): string =>
  `First user request:\n${boundSessionTitlePrompt(text)}`

export const deterministicSessionTitle = (
  parts: readonly AgentInputPart[],
  attachmentFilename?: string,
): string | null => {
  const text = parts.flatMap((part) => part.type === 'text' && part.text.trim() ? [part.text] : [])[0]
  const source = text ?? attachmentFilename
  return source ? normalizedWhitespace(source).slice(0, 96) || null : null
}

export const normalizeStoredSessionTitle = (value: string): string => {
  const title = normalizedWhitespace(value)
  if (!title) throw new Error('Session title cannot be empty.')
  if (title.length > 500) throw new Error('Session title cannot exceed 500 characters.')
  return title
}

export const normalizeGeneratedSessionTitle = (value: string, excludedTitle?: string): string | null => {
  const lines = value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^```(?:[a-z0-9_-]+)?$/i.test(line))
  let title = lines[0] ?? ''
  title = title
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/^(?:session\s+)?title\s*:\s*/i, '')
    .trim()

  const wrappers: Array<[string, string]> = [['"', '"'], ["'", "'"], ['`', '`'], ['“', '”'], ['‘', '’']]
  for (const [opening, closing] of wrappers) {
    if (title.startsWith(opening) && title.endsWith(closing) && title.length >= opening.length + closing.length) {
      title = title.slice(opening.length, -closing.length).trim()
      break
    }
  }

  title = normalizedWhitespace(title).split(' ').slice(0, 8).join(' ')
  if (title.length > 50) {
    const candidate = title.slice(0, 50)
    const boundary = candidate.lastIndexOf(' ')
    title = boundary > 0 ? candidate.slice(0, boundary) : candidate
  }
  title = title.replace(/[.!?,;:]+$/u, '').trim()
  if (!title || title === DEFAULT_SESSION_TITLE || title === excludedTitle) return null
  return title
}
