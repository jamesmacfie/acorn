import { randomUUID } from 'node:crypto'
import type { AgentSession, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import type { AgentStore } from './store'

export const agentTurnInputText = (turn: AgentTurn): string =>
  turn.input.flatMap((part) => {
    if (part.type === 'text') return [part.text]
    if (part.type === 'file') return [`@${part.path}`]
    if (part.type === 'context') return [`[Context: ${part.label}]`]
    return [`[Attachment: ${part.attachmentId}]`]
  }).join('\n\n')

export async function buildCompletedTurnTranscript(store: AgentStore, sessionId: string, turnId: string): Promise<{ taskId: string; transcript: string }> {
  const [snapshot, events] = await Promise.all([
    store.snapshot(sessionId, 0, 1),
    store.eventsForTurn(turnId),
  ])
  const turn = snapshot.turns.find((candidate) => candidate.id === turnId)
  const lines = [
    `Managed agent session: ${snapshot.session.id}`,
    `Managed agent turn: ${turnId}`,
    `Provider: ${snapshot.session.providerId}`,
    '',
    turn ? `User:\n${agentTurnInputText(turn)}` : '',
    ...events.flatMap((record) => {
      if (record.event.type === 'assistant_message') return [`Assistant:\n${record.event.text}`]
      if (record.event.type === 'tool') return [`Tool: ${record.event.tool.title} (${record.event.tool.status})`]
      if (record.event.type === 'file_change') return [`File change: ${record.event.path ?? record.event.summary ?? 'unknown'}`]
      return []
    }),
  ].filter(Boolean)
  return { taskId: snapshot.session.taskId, transcript: lines.join('\n\n').slice(-20_000) }
}

export async function buildForkContext(store: AgentStore, source: AgentSession): Promise<Extract<AgentTurn['input'][number], { type: 'context' }>> {
  const snapshot = await store.exportSnapshot(source.id)
  const lines = snapshot.events.slice(-200).flatMap((record) => {
    if (record.event.type === 'user_message') return [`User:\n${record.event.text}`]
    if (record.event.type === 'assistant_message') return [`Assistant:\n${record.event.text}`]
    if (record.event.type === 'file_change') return [`File change: ${record.event.path ?? record.event.summary ?? 'unspecified'}`]
    if (record.event.type === 'plan') return [`Plan:\n${record.event.entries.map((entry) => `- [${entry.status}] ${entry.text}`).join('\n')}`]
    return []
  })
  const content = lines.join('\n\n').slice(-100_000)
  const snapshotContent = [
    'This is an explicit Acorn context-copy fork, not provider-native history.',
    'The provider has not seen this snapshot until it is included with a new turn.',
    '',
    content || '(The source session has no displayable conversation events.)',
  ].join('\n')
  return {
    type: 'context',
    contextId: randomUUID(),
    label: `History copied from ${source.title}`,
    content: snapshotContent,
    source: 'agents',
    resourceId: source.id,
    provenance: `Managed session ${source.id}, events through sequence ${source.lastEventSeq}`,
    deepLink: { pane: 'agents', intent: { sessionId: source.id } },
    byteSize: Buffer.byteLength(snapshotContent, 'utf8'),
    estimatedTokens: Math.ceil(Buffer.byteLength(snapshotContent, 'utf8') / 4),
    freshness: 'cached',
    sensitivity: 'workspace',
    capturedAt: Date.now(),
  }
}
