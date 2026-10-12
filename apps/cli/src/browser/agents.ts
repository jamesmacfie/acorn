import type {
  AgentAttachment,
  AgentEventRecord,
  AgentProviderDescriptor,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/plugin-agents/contract/wire.ts'
import type {
  BridgeAgentHint,
  BridgeAgentProfile,
  BridgeAttachment,
  BridgeAttachmentRef,
  BridgeAgentSession,
  BridgeConversationEvent,
  BridgeConversationRecord,
  BridgeSessionRead,
} from '@acorn/protocol/extensionBridge.ts'

// The agents plugin's route bodies, narrowed to what the sidebar draws. The types are that plugin's
// contract, imported for types only, so the CLI bundle carries none of its code.

export const agentsRoute = '/v1/p/agents'
export const sessionRoute = (sessionId: string) => `${agentsRoute}/sessions/${encodeURIComponent(sessionId)}`
export const attachmentRoute = (attachmentId: string) =>
  `${agentsRoute}/attachments/${encodeURIComponent(attachmentId)}`

export const bridgeAttachment = (attachment: AgentAttachment): BridgeAttachment => ({
  id: attachment.id,
  taskId: attachment.taskId,
  filename: attachment.filename,
  mediaType: attachment.mediaType,
  byteSize: attachment.byteSize,
})

// What a turn sent besides its text, as the agents plugin's `messageAttachments` reads it.
const turnAttachments = (turn: AgentTurn | undefined): BridgeAttachmentRef[] =>
  (turn?.input ?? []).flatMap((part): BridgeAttachmentRef[] => {
    if (part.type === 'image') return [{ id: part.attachmentId, image: true, name: part.alt ?? null }]
    if (part.type === 'attachment') return [{ id: part.attachmentId, image: false, name: null }]
    return []
  })

// The turn's text names each attachment as `[Attachment: <id>]` for the agent. Once the attachments
// are listed beside it, the line says the same thing twice, so it goes, as in the agents transcript.
const withoutAttachmentLines = (text: string): string =>
  text
    .replace(/^\[Attachment: [^\]\n]+\]$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const bridgeProfile = (provider: AgentProviderDescriptor): BridgeAgentProfile => ({
  providerId: provider.id,
  profileId: provider.profileId,
  label: provider.label,
  installed: provider.installed,
  authenticated: provider.authenticated,
  diagnostics: provider.diagnostics,
})

export const bridgeSession = (session: AgentSession): BridgeAgentSession => ({
  id: session.id,
  taskId: session.taskId,
  title: session.title,
  providerId: session.providerId,
  profileId: session.profileId,
  kind: session.kind,
  runtimeState: session.runtimeState,
  attention: session.attention,
  lastEventSeq: session.lastEventSeq,
  archivedAt: session.archivedAt,
  updatedAt: session.updatedAt,
})

// A subagent's messages and tools belong to its own stream, which the sidebar doesn't draw. An
// automatic message isn't the person's, so the turn's attachments aren't drawn under it.
function conversationEvent(record: AgentEventRecord, turn: AgentTurn | undefined): BridgeConversationEvent | null {
  const event = record.event
  switch (event.type) {
    case 'user_message': {
      if (event.subagentId) return null
      const attachments = event.automatic ? [] : turnAttachments(turn)
      return attachments.length
        ? { type: 'user_message', text: withoutAttachmentLines(event.text), attachments }
        : { type: 'user_message', text: event.text }
    }
    case 'assistant_message':
      if (event.subagentId) return null
      return {
        type: 'assistant_message',
        text: event.text,
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.append ? { append: true } : {}),
      }
    case 'tool':
      if (event.tool.subagentId) return null
      return {
        type: 'tool',
        toolId: event.tool.id,
        ...(event.tool.title ? { title: event.tool.title } : {}),
        ...(event.tool.status ? { status: event.tool.status } : {}),
      }
    case 'error':
      return { type: 'error', message: event.message }
    default:
      return null
  }
}

// One page of a session, read with `fold=1` so each tool call arrives as one record. `reach` counts
// the records left out, so the next read starts past them rather than reading them again.
export function bridgeSessionRead(nodeId: string, snapshot: AgentSessionSnapshot, afterSeq: number): BridgeSessionRead {
  const records: BridgeConversationRecord[] = []
  const turns = new Map(snapshot.turns.map((turn) => [turn.id, turn]))
  let reach = afterSeq
  for (const record of snapshot.events) {
    reach = Math.max(reach, record.foldedThroughSeq ?? record.seq)
    const event = conversationEvent(record, record.turnId ? turns.get(record.turnId) : undefined)
    if (!event) continue
    records.push({
      id: record.id,
      seq: record.seq,
      turnId: record.turnId,
      createdAt: record.createdAt,
      ...(record.foldedThroughSeq !== undefined ? { foldedThroughSeq: record.foldedThroughSeq } : {}),
      event,
    })
  }
  return {
    nodeId,
    sessionId: snapshot.session.id,
    session: bridgeSession(snapshot.session),
    records,
    reach,
    queued: snapshot.turns
      .filter((turn) => turn.status === 'queued')
      .map((turn) => ({
        id: turn.id,
        text: turn.input.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
        attachments: turnAttachments(turn),
      })),
  }
}

// How long agent frames gather before one hint goes out. A working agent sends dozens a second; the
// sidebar needs to hear once that something changed.
const HINT_DELAY_MS = 250

// The agents plugin's frames reduced to which sessions and tasks they touched, gathered for a short
// while and sent as one hint. A frame names its session in one of these places depending on its
// channel, as the CLI's own `waitForHint` reads them. `ws:shed` is the Node saying it dropped frames
// for a slow reader, so the hint says anything may have changed.
export function agentHints(send: (hint: BridgeAgentHint) => void, delayMs = HINT_DELAY_MS) {
  let pending: BridgeAgentHint | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const hint = pending
    pending = null
    send({ ...hint, sessions: [...new Set(hint.sessions)], tasks: [...new Set(hint.tasks)] })
  }
  return {
    note(nodeId: string, frame: unknown) {
      const value = frame as {
        channel?: unknown
        sessionId?: string
        session?: { id?: string; taskId?: string }
        event?: { sessionId?: string }
        turn?: { sessionId?: string }
        request?: { sessionId?: string }
      } | null
      const channel = value?.channel
      if (typeof channel !== 'string' || !(channel.startsWith('agent:') || channel === 'ws:shed')) return
      if (pending && pending.nodeId !== nodeId) flush()
      pending ??= { nodeId, sessions: [], tasks: [], missed: false }
      if (channel === 'ws:shed') pending.missed = true
      const sessionId =
        value?.sessionId ??
        value?.session?.id ??
        value?.event?.sessionId ??
        value?.turn?.sessionId ??
        value?.request?.sessionId
      if (typeof sessionId === 'string') pending.sessions.push(sessionId)
      if (typeof value?.session?.taskId === 'string') pending.tasks.push(value.session.taskId)
      timer ??= setTimeout(flush, delayMs)
    },
    dispose() {
      clearTimeout(timer)
      pending = null
    },
  }
}
