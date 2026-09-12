import type { AgentEventRecord, AgentSession } from '@acorn/protocol/managedAgents.ts'

export type AgentReadItem =
  | { type: 'assistant_message'; text: string; turnId: string | null; fromSeq: number; toSeq: number; truncated?: boolean }
  | { type: 'diagnostic'; level: 'info' | 'warning'; message: string; turnId?: string; seq: number; truncated?: boolean }
  | { type: 'error'; code: string; message: string; retryable: boolean; turnId: string | null; seq: number; truncated?: boolean }
  | { type: 'structured_output'; value: unknown; turnId: string; seq: number }

export type AgentReadResult = {
  sessionId: string
  state: AgentSession['runtimeState']
  attention: AgentSession['attention']
  items: AgentReadItem[]
  nextCursor: number
  hasMore: boolean
}

/** Fold useful, bounded transcript events without projecting tool payloads or attachment bytes. */
export function foldReadableEvents(events: AgentEventRecord[]): AgentReadItem[] {
  const maxResponseChars = 64 * 1024
  const maxItemChars = 16 * 1024
  const items: AgentReadItem[] = []
  const messageIndexes = new Map<string, number>()
  let responseChars = 0
  const boundedText = (text: string, previousChars = 0) => {
    const room = Math.max(0, Math.min(maxItemChars, maxResponseChars - responseChars + previousChars))
    const value = text.slice(0, room)
    responseChars += value.length - previousChars
    return { value, truncated: value.length < text.length }
  }
  for (const record of events) {
    const event = record.event
    if (event.type === 'assistant_message') {
      const key = event.messageId
        ? `${record.turnId ?? 'session'}:${event.messageId}`
        : event.append ? `${record.turnId ?? 'session'}:anonymous` : null
      const existingIndex = key ? messageIndexes.get(key) : undefined
      if (existingIndex != null) {
        const existing = items[existingIndex]
        if (existing?.type === 'assistant_message') {
          const text = event.append ? existing.text + event.text : event.text
          const bounded = boundedText(text, existing.text.length)
          items[existingIndex] = {
            ...existing,
            text: bounded.value,
            toSeq: record.seq,
            ...(bounded.truncated ? { truncated: true } : {}),
          }
        }
      } else {
        const bounded = boundedText(event.text)
        if (!bounded.value && event.text) continue
        const index = items.push({
          type: 'assistant_message',
          text: bounded.value,
          turnId: record.turnId,
          fromSeq: record.seq,
          toSeq: record.seq,
          ...(bounded.truncated ? { truncated: true } : {}),
        }) - 1
        if (key) messageIndexes.set(key, index)
      }
    } else if (event.type === 'diagnostic') {
      const bounded = boundedText(event.message)
      if (bounded.value || !event.message) items.push({
        type: 'diagnostic',
        level: event.level,
        message: bounded.value,
        seq: record.seq,
        ...(bounded.truncated ? { truncated: true } : {}),
      })
    } else if (event.type === 'error') {
      const bounded = boundedText(event.message)
      if (!bounded.value && event.message) continue
      items.push({
        type: 'error',
        code: event.code,
        message: bounded.value,
        retryable: event.retryable,
        turnId: record.turnId,
        seq: record.seq,
        ...(bounded.truncated ? { truncated: true } : {}),
      })
    }
  }
  return items
}
