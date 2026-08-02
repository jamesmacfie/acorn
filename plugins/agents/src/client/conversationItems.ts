import type { AgentEventRecord, AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'

export type AgentConversationItem = {
  key: string
  firstSeq: number
  lastSeq: number
  turnId: string | null
  event: AgentNormalizedEvent
}

type AppendableEvent = Extract<AgentNormalizedEvent, { type: 'assistant_message' | 'reasoning' }>
const isAppendable = (event: AgentNormalizedEvent): event is AppendableEvent =>
  event.type === 'assistant_message' || event.type === 'reasoning'

export function buildConversationItems(events: AgentEventRecord[]): AgentConversationItem[] {
  const output: AgentConversationItem[] = []
  for (const record of [...events].sort((a, b) => a.seq - b.seq)) {
    const previous = output[output.length - 1]
    if (
      previous
      && previous.turnId === record.turnId
      && isAppendable(previous.event)
      && isAppendable(record.event)
      && previous.event.type === record.event.type
      && record.event.append
      && previous.event.messageId === record.event.messageId
    ) {
      output[output.length - 1] = {
        ...previous,
        lastSeq: record.seq,
        event: { ...previous.event, text: previous.event.text + record.event.text },
      }
      continue
    }
    output.push({
      key: record.id,
      firstSeq: record.seq,
      lastSeq: record.seq,
      turnId: record.turnId,
      event: record.event,
    })
  }
  return output
}
