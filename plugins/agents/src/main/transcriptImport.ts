import { z } from 'zod'

export type ImportedTranscriptTurn = {
  user: string
  assistant: string[]
}

export type ImportedTranscript = {
  title?: string
  providerSessionRef?: string
  turns: ImportedTranscriptTurn[]
}

const textParts = (value: unknown): string[] => {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((part) => {
    if (typeof part === 'string') return part.trim() ? [part] : []
    if (!part || typeof part !== 'object') return []
    const record = part as Record<string, unknown>
    const text = record.text ?? record.content
    return typeof text === 'string' && text.trim() ? [text] : []
  })
}

const pushMessage = (
  turns: ImportedTranscriptTurn[],
  role: string,
  parts: string[],
): void => {
  if (!parts.length) return
  if (role === 'user') {
    turns.push({ user: parts.join('\n\n'), assistant: [] })
    return
  }
  if (role === 'assistant') {
    const turn = turns.at(-1)
    if (turn) turn.assistant.push(...parts)
  }
}

function parseJsonLines(content: string): ImportedTranscript {
  const turns: ImportedTranscriptTurn[] = []
  let providerSessionRef: string | undefined
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (!value || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    const payload = record.payload && typeof record.payload === 'object'
      ? record.payload as Record<string, unknown>
      : record
    const message = record.message && typeof record.message === 'object'
      ? record.message as Record<string, unknown>
      : payload
    const sessionRef = record.sessionId ?? record.session_id
      ?? (record.type === 'session_meta' ? payload.id : undefined)
    if (typeof sessionRef === 'string' && sessionRef) providerSessionRef = sessionRef
    const payloadType = typeof payload.type === 'string' ? payload.type : ''
    const role = typeof message.role === 'string'
      ? message.role
      : payloadType === 'user_message'
        ? 'user'
        : payloadType === 'assistant_message'
          ? 'assistant'
          : ''
    if (!role) continue
    pushMessage(turns, role, textParts(message.content ?? message.text))
  }
  return { providerSessionRef, turns: turns.filter((turn) => turn.user.trim()) }
}

const AcornExportSchema = z.object({
  session: z.object({
    title: z.string().optional(),
    providerSessionRef: z.string().nullable().optional(),
  }),
  turns: z.array(z.object({
    id: z.string(),
    input: z.array(z.object({ type: z.string() }).passthrough()),
  })),
  events: z.array(z.object({
    turnId: z.string().nullable(),
    event: z.object({ type: z.string() }).passthrough(),
  })),
})

function parseAcornExport(value: unknown): ImportedTranscript | null {
  const parsed = AcornExportSchema.safeParse(value)
  if (!parsed.success) return null
  const eventsByTurn = new Map<string, string[]>()
  for (const record of parsed.data.events) {
    if (!record.turnId || record.event.type !== 'assistant_message') continue
    const text = record.event.text
    if (typeof text !== 'string' || !text.trim()) continue
    const current = eventsByTurn.get(record.turnId) ?? []
    current.push(text)
    eventsByTurn.set(record.turnId, current)
  }
  return {
    title: parsed.data.session.title,
    providerSessionRef: parsed.data.session.providerSessionRef ?? undefined,
    turns: parsed.data.turns.flatMap((turn) => {
      const user = turn.input.flatMap((part) =>
        part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n\n')
      return user.trim() ? [{ user, assistant: eventsByTurn.get(turn.id) ?? [] }] : []
    }),
  }
}

function parseMarkdown(content: string): ImportedTranscript {
  const turns: ImportedTranscriptTurn[] = []
  let role: 'user' | 'assistant' | null = null
  let buffer: string[] = []
  const flush = () => {
    const text = buffer.join('\n').trim()
    if (role && text) pushMessage(turns, role, [text])
    buffer = []
  }
  for (const line of content.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(user|assistant)\s*$/i.exec(line)
    if (heading) {
      flush()
      role = heading[1]!.toLowerCase() as 'user' | 'assistant'
    } else if (role) {
      buffer.push(line)
    }
  }
  flush()
  return { turns }
}

export function parseAgentTranscript(content: string): ImportedTranscript {
  if (Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) {
    throw new Error('Transcript imports are limited to 10 MiB.')
  }
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Transcript is empty.')
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as unknown
      const acorn = parseAcornExport(value)
      if (acorn?.turns.length) return acorn
    } catch {
      // Provider transcript formats are commonly JSONL rather than one JSON document.
    }
    const jsonl = parseJsonLines(trimmed)
    if (jsonl.turns.length) return jsonl
  }
  const markdown = parseMarkdown(trimmed)
  if (markdown.turns.length) return markdown
  throw new Error('No user/assistant turns were found in this transcript.')
}
