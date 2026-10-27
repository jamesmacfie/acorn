import type {
  AgentAttachment,
  AgentEventRecord,
  AgentProviderDescriptor,
  AgentRequest,
  AgentRequestKind,
  AgentSession,
  AgentSessionSnapshot,
  AgentToolCall,
  AgentTurn,
} from '@acorn/plugin-agents/contract/wire.ts'
import {
  appApprovalOf,
  approvalScopeNote,
  approvalSentNote,
  approvalTarget,
  sentOptionId,
} from '@acorn/plugin-agents/contract/appApproval.ts'
import type { AgentLifecycleFrame } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { sessionModelSummary } from '@acorn/plugin-agents/contract/sessionModel.ts'
import {
  choiceAccountIcon,
  choiceAvailable,
  choiceDescription,
  choiceGlyph,
  choiceLabel,
  choiceText,
  newSessionChoices,
  type CustomAgent,
} from '@acorn/plugin-agents/contract/newSessionChoices.ts'
import { readAppShowCall } from '@acorn/plugin-trellis/contract/appShowCall.ts'
import { readPanelShowCall } from '@acorn/protocol/panelShowCall.ts'
import type {
  BridgeAgentHint,
  BridgeAgentChoice,
  BridgeAgentRequest,
  BridgeAttachment,
  BridgeAttachmentRef,
  BridgeAgentSession,
  BridgeConversationEvent,
  BridgeConversationRecord,
  BridgeSessionRead,
  BridgeToolCard,
} from '@acorn/protocol/extensionBridge.ts'

// The agents plugin's route bodies, narrowed to what the sidebar draws. The types are that plugin's
// contract. The only code the CLI bundle takes from it is the app-access wording, the model line, and
// the New picker's rows in its contract, so the sidebar describes a grant, a session, and an agent to
// start in the same words as the desktop. A panel or app call is read with the readers the desktop's
// cards use, so the sidebar names it as they do.

export const agentsRoute = '/v1/p/agents'
export const sessionRoute = (sessionId: string) => `${agentsRoute}/sessions/${encodeURIComponent(sessionId)}`
export const toolCallRoute = (sessionId: string, toolId: string) =>
  `${sessionRoute(sessionId)}/tools/${encodeURIComponent(toolId)}`
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

// The desktop's New rows, from the Node's harnesses and custom agents.
export const bridgeChoices = (
  providers: readonly AgentProviderDescriptor[],
  agents: readonly CustomAgent[],
): BridgeAgentChoice[] =>
  newSessionChoices(providers, agents).map((choice) => ({
    providerId: choice.provider.id,
    profileId: choice.provider.profileId,
    customAgentId: choice.agent?.id ?? null,
    account: choice.account ?? null,
    label: choiceLabel(choice),
    text: choiceText(choice),
    description: choiceDescription(choice),
    glyph: choiceGlyph(choice) ?? null,
    accountIcon: choiceAccountIcon(choice) ?? null,
    available: choiceAvailable(choice),
  }))

export const bridgeSession = (session: AgentSession): BridgeAgentSession => ({
  id: session.id,
  taskId: session.taskId,
  title: session.title,
  providerId: session.providerId,
  profileId: session.profileId,
  model: sessionModelSummary(session) ?? null,
  kind: session.kind,
  inline: session.origin?.kind === 'inline-diff',
  btw: session.origin?.kind === 'btw',
  runtimeState: session.runtimeState,
  attention: session.attention,
  lastEventSeq: session.lastEventSeq,
  archivedAt: session.archivedAt,
  updatedAt: session.updatedAt,
})

// The most a card line carries, so a call's input and output can't fill a page: a title, name, or note,
// and a description's lines.
const CARD_TEXT_LIMIT = 200
const DESCRIPTION_LINE_LIMIT = 300
const DESCRIPTION_LINES = 8

// A harness records a refused call as completed, with the error as its output, so a call that finished
// without a result didn't pass its checks, as the desktop's cards read it.
const failedChecks = (status: AgentToolCall['status'], result: unknown): boolean =>
  status !== undefined && status !== 'pending' && status !== 'running' && (status !== 'completed' || !result)

// What a `panel_show` or `app_show` call drew, from what this record holds of its input and output.
// The tool's MCP name says which, never its title, which each harness writes its own way.
function toolCard(tool: AgentToolCall): BridgeToolCard | undefined {
  if (tool.name === 'panel_show') {
    const { input, result } = readPanelShowCall(tool)
    return {
      kind: 'panel',
      ...(input ? { title: input.title.slice(0, CARD_TEXT_LIMIT) } : {}),
      ...(result
        ? {
            description: result.description
              .slice(0, DESCRIPTION_LINES)
              .map((line) => line.slice(0, DESCRIPTION_LINE_LIMIT)),
            panelId: result.panelId.slice(0, CARD_TEXT_LIMIT),
            shownAt: result.shownAt,
          }
        : {}),
      ...(failedChecks(tool.status, result) ? { failed: true } : {}),
    }
  }
  if (tool.name === 'app_show') {
    const { input, result } = readAppShowCall(tool)
    return {
      kind: 'app',
      ...(input ? { appId: input.appId, note: input.note.slice(0, CARD_TEXT_LIMIT) } : {}),
      ...(result ? { name: result.name.slice(0, CARD_TEXT_LIMIT), revision: result.revision } : {}),
      ...(failedChecks(tool.status, result) ? { failed: true } : {}),
    }
  }
  return undefined
}

// A subagent's messages and tools belong to its own stream, which the sidebar doesn't draw. An
// automatic message isn't the person's, so the turn's attachments aren't drawn under it.
function conversationEvent(record: AgentEventRecord, turn: AgentTurn | undefined): BridgeConversationEvent | null {
  const event = record.event
  switch (event.type) {
    case 'user_message': {
      if (event.subagentId) return null
      const attachments = event.automatic ? [] : turnAttachments(turn)
      // A step's prompt, as the desktop labels it. The nudge a step sends after a turn ends without its
      // result continues an earlier turn, and the desktop names Acorn as its sender instead.
      const workflow = turn?.source === 'workflow' && !turn.effectivePolicy.continuationOf
      return {
        type: 'user_message',
        text: attachments.length ? withoutAttachmentLines(event.text) : event.text,
        ...(attachments.length ? { attachments } : {}),
        ...(workflow ? { workflow: true } : {}),
      }
    }
    case 'assistant_message':
      if (event.subagentId) return null
      return {
        type: 'assistant_message',
        text: event.text,
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.append ? { append: true } : {}),
      }
    case 'tool': {
      if (event.tool.subagentId) return null
      const card = toolCard(event.tool)
      return {
        type: 'tool',
        toolId: event.tool.id,
        ...(event.tool.title ? { title: event.tool.title } : {}),
        ...(event.tool.status ? { status: event.tool.status } : {}),
        ...(card ? { card } : {}),
      }
    }
    case 'error':
      return { type: 'error', message: event.message }
    default:
      return null
  }
}

// The kinds whose answer is a button or a form. A workflow gate, or a kind a newer Node adds, may mean
// something else, so the sidebar shows it without offering an answer.
const ANSWERABLE_KINDS: ReadonlySet<string> = new Set<AgentRequestKind>(['permission', 'question', 'elicitation'])

// How many settled requests a read carries besides the open ones: enough for a request answered
// elsewhere to read as settled, without sending a long session's whole history on every read.
const SETTLED_REQUESTS = 10

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

type Parsed<T> = { rows: T[]; malformed: boolean }

function parseRows<T>(value: unknown, row: (entry: Record<string, unknown>) => T | null): Parsed<T> {
  if (value === undefined) return { rows: [], malformed: false }
  if (!Array.isArray(value)) return { rows: [], malformed: true }
  const rows = value.flatMap((entry) => {
    const parsed = isRecord(entry) ? row(entry) : null
    return parsed ? [parsed] : []
  })
  return { rows, malformed: rows.length !== value.length }
}

const parseOption = (entry: Record<string, unknown>): BridgeAgentRequest['options'][number] | null => {
  const id = text(entry.id)
  const label = text(entry.label)
  return id && label ? { id, label, reject: typeof entry.kind === 'string' && entry.kind.startsWith('reject') } : null
}

const parseQuestion = (entry: Record<string, unknown>): BridgeAgentRequest['questions'][number] | null => {
  const id = text(entry.id)
  const prompt = text(entry.prompt)
  const options = parseRows(entry.options, (option) => {
    const label = text(option.label)
    return label ? { label, description: text(option.description) } : null
  })
  if (!id || !prompt || options.malformed) return null
  return {
    id,
    header: text(entry.header),
    prompt,
    options: options.rows,
    multiple: entry.multiple === true,
    secret: entry.secret === true,
  }
}

// A request row as the sidebar draws it. The payload is checked here, once, at the edge of the Node's
// answer: a request whose choices don't read, or whose app access has no readable scope, is shown with
// a reason instead of a guessed answer. A form's answers never leave the Node, because some are secret.
export function bridgeRequest(request: AgentRequest): BridgeAgentRequest {
  const options = parseRows(request.payload.options, parseOption)
  const questions = parseRows(request.payload.questions, parseQuestion)
  const approval = request.payload.approval === undefined ? null : appApprovalOf(request.payload.approval)
  const optionId = sentOptionId(request)
  const unsupported = !ANSWERABLE_KINDS.has(request.kind)
    ? `The extension can't answer a ${request.kind.replace('_', ' ')} request yet. Answer it in the Acorn app.`
    : options.malformed || questions.malformed
      ? "Some of this request's choices don't read, so the extension won't guess an answer. Answer it in the Acorn app."
      : request.payload.approval !== undefined && !approval
        ? "This request's app access doesn't read, so the extension can't show what it grants. Answer it in the Acorn app."
        : !options.rows.length && !questions.rows.length
          ? 'This request offers no answer the extension can send. Answer it in the Acorn app.'
          : null
  return {
    requestId: request.providerRequestId,
    kind: request.kind,
    status: request.status,
    title: request.title,
    detail: request.detail,
    options: options.rows,
    questions: questions.rows,
    approval: approval
      ? { target: approvalTarget(approval), scopeNote: approvalScopeNote(approval), warning: approval.warning ?? null }
      : null,
    answer: options.rows.find((option) => option.id === optionId)?.label ?? null,
    sentNote: approval ? approvalSentNote(approval, optionId) : null,
    unsupported,
  }
}

// Every open request, oldest first, then the most recently settled. A request settled long ago is in
// the conversation's history, not something to act on.
function sessionRequests(requests: readonly AgentRequest[]): BridgeAgentRequest[] {
  const open = requests.filter((request) => request.status === 'pending' || request.status === 'resolving')
  const settled = requests
    .filter((request) => request.status === 'resolved' || request.status === 'expired')
    .sort((left, right) => (right.resolvedAt ?? 0) - (left.resolvedAt ?? 0))
    .slice(0, SETTLED_REQUESTS)
  return [...open, ...settled].map(bridgeRequest)
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
    requests: sessionRequests(snapshot.requests ?? []),
  }
}

// How long agent frames gather before one hint goes out. A working agent sends dozens a second; the
// sidebar needs to hear once that something changed.
const HINT_DELAY_MS = 250
const REQUEST_CHANGED: AgentLifecycleFrame['channel'] = 'plugin:agents:request-changed'

// The agents plugin's frames reduced to which sessions and tasks they touched, gathered for a short
// while and sent as one hint. A frame names its session in one of these places depending on its
// channel, as the CLI's own `waitForHint` reads them. `ws:shed` is the Node saying it dropped frames
// for a slow reader, so the hint says anything may have changed. The plugin's lifecycle frame
// `plugin:agents:request-changed` is the one sign of every request change, expiry included, which no
// `agent:` frame reports.
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
        taskId?: string
      } | null
      const channel = value?.channel
      const requestChanged = channel === REQUEST_CHANGED
      if (typeof channel !== 'string' || !(channel.startsWith('agent:') || channel === 'ws:shed' || requestChanged))
        return
      if (pending && pending.nodeId !== nodeId) flush()
      pending ??= { nodeId, sessions: [], tasks: [], missed: false, requests: false }
      if (channel === 'ws:shed') pending.missed = true
      if (requestChanged) {
        pending.requests = true
        if (typeof value?.taskId === 'string') pending.tasks.push(value.taskId)
      }
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
