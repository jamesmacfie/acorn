import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentSubagentUpdate,
  AgentToolCall,
} from '@acorn/protocol/managedAgents.ts'
// The same merge the node's snapshot fold and the transcript store apply. This fold is now defensive:
// both sources hand the transcript one usage record a turn already, and it still runs so that a
// replayed page, an older node, or a subagent's roster usage folds the way it always did.
import { mergeAgentUsage as mergeUsage } from '../../shared/usageFold'

export type AgentConversationItem = {
  key: string
  firstSeq: number
  lastSeq: number
  turnId: string | null
  event: AgentNormalizedEvent
  /** Present on a subagent card: what that subagent did, in its own order. */
  children?: AgentConversationItem[]
}

// Which events are worth a card. `session_state`, `session_metadata`, `request` and `request_resolved`
// are all projected elsewhere: state into the pane header, requests into the strip above the list.
// Exported because the transcript and a subagent card render from the same tree and have to agree.
const VISIBLE_EVENT_TYPES = new Set<AgentNormalizedEvent['type']>([
  'user_message',
  'assistant_message',
  'reasoning',
  'tool',
  'subagent',
  'plan',
  'usage',
  'file_change',
  'terminal',
  'artifact',
  'turn_completed',
  'error',
  'diagnostic',
])

export const visibleConversationItems = (items: AgentConversationItem[]): AgentConversationItem[] =>
  items.filter((item) => VISIBLE_EVENT_TYPES.has(item.event.type))

/** The card for one subagent, so a caller can render that subagent's run on its own. */
export const findSubagentItem = (
  items: AgentConversationItem[],
  subagentId: string,
): AgentConversationItem | undefined =>
  items.find((item) => item.event.type === 'subagent' && item.event.subagent.id === subagentId)

type AppendableEvent = Extract<AgentNormalizedEvent, { type: 'assistant_message' | 'reasoning' }>
const isAppendable = (event: AgentNormalizedEvent): event is AppendableEvent =>
  event.type === 'assistant_message' || event.type === 'reasoning'

// Field by field rather than a spread: the normalizers write absent values as present-but-undefined
// keys, which a spread would use to wipe what an earlier update reported.
const mergeToolCall = (previous: AgentToolCall, next: AgentToolCall): AgentToolCall => ({
  id: previous.id,
  parentId: next.parentId ?? previous.parentId,
  title: next.title || previous.title,
  kind: next.kind ?? previous.kind,
  status: next.status ?? previous.status,
  input: next.input ?? previous.input,
  output: next.outputAppend
    ? (previous.output ?? '') + (next.output ?? '')
    : next.output ?? previous.output,
  paths: next.paths ?? previous.paths,
  subagentId: next.subagentId ?? previous.subagentId,
})


// Same convention. A harness that only learns the model at completion must not wipe the title it
// reported at spawn, and one that reports usage twice must not lose the first half of it.
const mergeSubagent = (previous: AgentSubagentUpdate, next: AgentSubagentUpdate): AgentSubagentUpdate => ({
  id: previous.id,
  title: next.title || previous.title,
  status: next.status ?? previous.status,
  role: next.role ?? previous.role,
  model: next.model ?? previous.model,
  providerAgentRef: next.providerAgentRef ?? previous.providerAgentRef,
  usage: next.usage && previous.usage
    ? mergeUsage(previous.usage, next.usage)
    : next.usage ?? previous.usage,
  toolUseCount: next.toolUseCount ?? previous.toolUseCount,
  durationMs: next.durationMs ?? previous.durationMs,
})

// Whose stream an event belongs to. Absent means the session's own.
const subagentIdOf = (event: AgentNormalizedEvent): string | undefined => {
  if (event.type === 'tool') return event.tool.subagentId
  if (event.type === 'assistant_message' || event.type === 'reasoning' || event.type === 'file_change') {
    return event.subagentId
  }
  return undefined
}

// One agent's run of cards. A usage line is per stream, so a subagent's token count cannot update the
// parent's; tool cards are tracked across the whole transcript instead, for the reason on `toolCards`
// below.
type Stream = {
  items: AgentConversationItem[]
  usageCardAt: number | undefined
  planCardAtByTurn: Map<string, number>
}

const newStream = (): Stream => ({ items: [], usageCardAt: undefined, planCardAtByTurn: new Map() })

export function buildConversationItems(events: AgentEventRecord[]): AgentConversationItem[] {
  const top = newStream()
  // ponytail: one level of nesting. Both harnesses let a subagent spawn a subagent, and its card
  // becomes a sibling at the top rather than a grandchild. Give the roster a parent id and recurse
  // here if a deep fan-out ever reads as flat.
  const streams = new Map<string, Stream>()
  const subagentCardAt = new Map<string, number>()
  // Tool cards are found across streams, not within one, because a provider need not repeat the
  // attribution on every update. Claude's adapter tags a subagent's `tool_call` and its final
  // `tool_call_update` with the owning agent and leaves the one in between untagged; a per-stream
  // lookup could not find the card that update belonged to, so it opened a second one at the top level,
  // titled with the raw tool id because a mid-call update carries no title either. A tool call belongs
  // to whoever opened it, and every later update folds there wherever it arrives from.
  const toolCards = new Map<string, { stream: Stream; at: number }>()

  // Tools, usage, subagents, and plans report evolving state rather than separate moments, so each is
  // folded into the card it started rather than appended. The event ledger still stores a row per
  // provider update, which is what replay and any later timing question read. A plan is a complete
  // snapshot and folds only within its own turn; a later turn's plan is a separate piece of work.
  //
  // A tool call is keyed by turn and tool id, so a command reads as one panel whose status and output
  // change in place. Plans are keyed by turn. Usage is keyed by turn, with one allowance: a turn's last
  // usage update can arrive after the turn is marked complete, which leaves it with no turn id, and it
  // belongs to the line it is updating. That trailing update is how a cost reaches a line that started
  // with only a context count, which used to render as a second, near-identical line. A subagent folds
  // like a tool call, by id, so a completion summary lands on the card the spawn opened.
  const toolKey = (record: AgentEventRecord, tool: AgentToolCall) =>
    `${record.turnId ?? 'session'}:${tool.id}`
  // Which existing card this record updates, and in which stream. `undefined` means it opens a new one.
  const foldTarget = (
    record: AgentEventRecord,
    stream: Stream,
  ): { stream: Stream; at: number } | undefined => {
    if (record.event.type === 'tool') return toolCards.get(toolKey(record, record.event.tool))
    if (record.event.type === 'subagent') {
      const at = subagentCardAt.get(record.event.subagent.id)
      return at === undefined ? undefined : { stream: top, at }
    }
    if (record.event.type === 'plan' && record.turnId !== null) {
      const at = stream.planCardAtByTurn.get(record.turnId)
      return at === undefined ? undefined : { stream, at }
    }
    if (record.event.type !== 'usage' || stream.usageCardAt === undefined) return undefined
    return record.turnId === null || record.turnId === stream.items[stream.usageCardAt].turnId
      ? { stream, at: stream.usageCardAt }
      : undefined
  }
  const folded = (card: AgentNormalizedEvent, update: AgentNormalizedEvent): AgentNormalizedEvent => {
    if (card.type === 'tool' && update.type === 'tool') {
      return { type: 'tool', tool: mergeToolCall(card.tool, update.tool) }
    }
    if (card.type === 'usage' && update.type === 'usage') {
      return { type: 'usage', usage: mergeUsage(card.usage, update.usage) }
    }
    if (card.type === 'subagent' && update.type === 'subagent') {
      return { type: 'subagent', subagent: mergeSubagent(card.subagent, update.subagent) }
    }
    return update
  }

  // Copied and sorted unconditionally, and left that way after measuring it: on a 1,850-row session
  // both this and an in-order check that would skip it come in around 0.05 ms, because V8's sort walks
  // an already-ordered array in one pass. Guarding it buys nothing worth a branch.
  for (const record of [...events].sort((a, b) => a.seq - b.seq)) {
    const owner = subagentIdOf(record.event)
    // An orphan stays visible at the top rather than being dropped: the subagent card is normally the
    // event before its first child, but a truncated replay can start mid-stream.
    const stream = (owner ? streams.get(owner) : undefined) ?? top
    const fold = foldTarget(record, stream)
    if (fold) {
      const card = fold.stream.items[fold.at]
      // Spread, so a subagent card keeps the `children` array its stream is still pushing into.
      fold.stream.items[fold.at] = { ...card, lastSeq: record.seq, event: folded(card.event, record.event) }
      continue
    }
    if (record.event.type === 'tool') {
      toolCards.set(toolKey(record, record.event.tool), { stream, at: stream.items.length })
    }
    if (record.event.type === 'usage') stream.usageCardAt = stream.items.length
    if (record.event.type === 'plan' && record.turnId !== null) {
      stream.planCardAtByTurn.set(record.turnId, stream.items.length)
    }

    const previous = stream.items[stream.items.length - 1]
    if (
      previous
      && previous.turnId === record.turnId
      && isAppendable(previous.event)
      && isAppendable(record.event)
      && previous.event.type === record.event.type
      && record.event.append
      && previous.event.messageId === record.event.messageId
    ) {
      stream.items[stream.items.length - 1] = {
        ...previous,
        lastSeq: record.seq,
        event: { ...previous.event, text: previous.event.text + record.event.text },
      }
      continue
    }

    const item: AgentConversationItem = {
      key: record.id,
      firstSeq: record.seq,
      lastSeq: record.seq,
      turnId: record.turnId,
      event: record.event,
    }
    // A subagent card owns a stream, and `children` is that stream's own array, so everything the
    // subagent does afterwards appears inside the card without another pass over the transcript.
    if (record.event.type === 'subagent') {
      const child = newStream()
      streams.set(record.event.subagent.id, child)
      subagentCardAt.set(record.event.subagent.id, top.items.length)
      item.children = child.items
    }
    stream.items.push(item)
  }
  return top.items
}
