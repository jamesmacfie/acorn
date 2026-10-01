import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentRequest,
  AgentSubagentUpdate,
} from '../../contract/wire.ts'
// The same merge the node's snapshot fold and the transcript store apply. This fold is now defensive:
// both sources hand the transcript one usage record a turn already, and it still runs so that a
// replayed page, an older node, or a subagent's roster usage folds the way it always did.
import { mergeAgentUsage as mergeUsage } from '../../shared/usageFold'
// Tool calls fold by the same rule on the node too, for a reader that asks (../../shared/toolFold.ts).
import { mergeToolCall, toolCardKey } from '../../shared/toolFold'

export type AgentConversationItem = {
  key: string
  firstSeq: number
  lastSeq: number
  /** When the first event for this card reached the Node. Updates never move the card's time. */
  createdAt: number
  turnId: string | null
  event: AgentNormalizedEvent
  /** Present on a subagent card: what that subagent did, in its own order. */
  children?: AgentConversationItem[]
  /** Present on a `turn_completed` card: how much of the model's context window was in use when the
   *  turn ended. Stamped from the turn's own usage card by `stampTurnContext` below. */
  context?: { used: number; size?: number }
}

// Which events are worth a card. `session_state`, `session_metadata` and `request_resolved` are all
// projected elsewhere: state into the pane header, and a resolution onto the request card it answers.
// Exported because the transcript and a subagent card render from the same tree and have to agree.
const VISIBLE_EVENT_TYPES = new Set<AgentNormalizedEvent['type']>([
  'user_message',
  'assistant_message',
  'reasoning',
  'tool',
  'subagent',
  'plan',
  'plan_proposal',
  'request',
  'file_change',
  'terminal',
  'artifact',
  'turn_completed',
  'error',
  'diagnostic',
])

// `usage` is deliberately absent above. Its tokens and its provider cost used to be a line of their own
// at the head of each turn; the cost is a plugin's job now (agents:session-header) and the context
// figure rides the turn's closing line, so the card had nothing left to say that the transcript did
// not already say twice. The events still fold, because that fold is what feeds the closing line.

// Anything the agent is blocked on is drawn where it asked, because that is the moment it interrupted
// and answering it there costs no hunting. What happens afterwards differs by kind. A question stays:
// what it was told is part of the record. A permission goes: it is a decision about one tool call, the
// call already has a card of its own, and a busy session would bury itself under them.
//
// So this needs the request row and not only the event, since only the row knows whether anybody has
// answered yet. A caller with no rows to hand is drawing a subagent's own stream, which never contains
// one (`subagentIdOf` below), so the lookup is optional.
const belongsInThread = (
  event: AgentNormalizedEvent,
  requestFor: RequestLookup | undefined,
): boolean => {
  if (event.type !== 'request') return true
  if (event.kind !== 'permission') return true
  const status = requestFor?.(event.requestId)?.status
  return status === 'pending' || status === 'resolving'
}

export type RequestLookup = (requestId: string) => AgentRequest | undefined

export const visibleConversationItems = (
  items: AgentConversationItem[],
  requestFor?: RequestLookup,
): AgentConversationItem[] =>
  items.filter((item) => VISIBLE_EVENT_TYPES.has(item.event.type) && belongsInThread(item.event, requestFor))

/** A card that is somebody talking — the reader or the agent — as opposed to a tool call, reasoning,
 *  or a note. What the "show chats only" toggle above the composer keeps.
 *
 *  A request counts. It is the agent asking the reader something and the reader answering, which is
 *  the same conversation as a message, and during planning it is most of it: hiding it left a chat-only
 *  transcript where the agent asked nothing and settled a question out of nowhere. `belongsInThread`
 *  above has already dropped the resolved permissions, so what is left is the questions and whatever
 *  is still blocking. */
export const isChatItem = (item: AgentConversationItem): boolean =>
  item.event.type === 'user_message'
  || item.event.type === 'assistant_message'
  || item.event.type === 'request'
  || item.event.type === 'plan_proposal'

/** The card for one subagent, so a caller can render that subagent's run on its own. */
export const findSubagentItem = (
  items: AgentConversationItem[],
  subagentId: string,
): AgentConversationItem | undefined =>
  items.find((item) => item.event.type === 'subagent' && item.event.subagent.id === subagentId)

type AppendableEvent = Extract<AgentNormalizedEvent, { type: 'assistant_message' | 'reasoning' }>
const isAppendable = (event: AgentNormalizedEvent): event is AppendableEvent =>
  event.type === 'assistant_message' || event.type === 'reasoning'

// Field by field, for the reason on `mergeToolCall` (../../shared/toolFold.ts). A harness that only
// learns the model at completion must not wipe the title it reported at spawn, and one that reports
// usage twice must not lose the first half of it.
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
  if (
    event.type === 'user_message' || event.type === 'assistant_message'
    || event.type === 'reasoning' || event.type === 'file_change'
  ) {
    return event.subagentId
  }
  return undefined
}

// One agent's run of cards. A usage line is per stream, so a subagent's token count cannot update the
// parent's; tool cards are tracked across the whole transcript instead, for the reason on `toolCards`
// below. A subagent's stream also knows where its card sits, so the card can be handed a fresh copy
// of the run each time the run changes.
type Stream = {
  items: AgentConversationItem[]
  usageCardAt: number | undefined
  planCardAtByTurn: Map<string, number>
  /** Where the card that owns this stream sits in the session's own stream. Absent on that one. */
  cardAt?: number
}

const newStream = (cardAt?: number): Stream => ({ items: [], usageCardAt: undefined, planCardAtByTurn: new Map(), cardAt })

// A record the node already folded (`foldedThroughSeq`) stands in for every update of its card up to
// that seq, so the card's `lastSeq` jumps there, and a row at or below it is one that record already
// holds: a page re-read, a socket frame the refetch overtook. Applying it twice would repeat appended
// output.
const reach = (record: AgentEventRecord) => record.foldedThroughSeq ?? record.seq

const openItem = (record: AgentEventRecord): AgentConversationItem => ({
  key: record.id,
  firstSeq: record.seq,
  lastSeq: reach(record),
  createdAt: record.createdAt,
  turnId: record.turnId,
  event: record.event,
})

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

// Spread, so a subagent card keeps the `children` it was last handed.
const foldInto = (card: AgentConversationItem, record: AgentEventRecord): AgentConversationItem =>
  ({ ...card, lastSeq: reach(record), event: folded(card.event, record.event) })

type Fold = {
  /** Take the next record. Records must come in seq order. */
  add(record: AgentEventRecord): void
  /** Take the last usage record again after the store merged a later update into it in place. */
  replaceLastUsage(record: AgentEventRecord): void
  /** The session's own stream as it stands, and which of the positions an earlier `settle` handed out
   *  have changed since. The array is the fold's own: copy it before keeping it. */
  settle(): { items: AgentConversationItem[]; changed: number[] }
}

// The projection as a fold that stays open. `buildConversationItems` opens one and adds every record;
// a streaming transcript keeps its fold and adds each record as it lands
// (`createConversationProjection` below). Both run this code, so there is no second copy of the fold
// to drift from the first.
function openFold(): Fold {
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
  // A file change folds the same way, by the edit it belongs to and the file. Both harnesses report an
  // edit more than once as it firms up: Claude sends an excerpt when the call starts and the real hunks
  // once it has run, Codex streams patch updates before the item completes, and Codex's whole-turn diff
  // arrives again every time the turn's diff grows. The reader wants the last word on each, once.
  const fileChangeCards = new Map<string, { stream: Stream; at: number }>()
  // What changed since the last `settle`. Positions past `settled` are new, so they need no entry.
  let settled = 0
  const changed = new Set<number>()
  const grown = new Set<Stream>()
  // The turn-closing lines since the newest usage card: the ones whose context figure that card sets.
  let closedSinceUsage: number[] = []
  // Where the last usage record went, and the card as it was before it, so that record can be taken
  // again (`replaceLastUsage`).
  let lastUsage: { at: number; before: AgentConversationItem | undefined } | undefined

  const write = (stream: Stream, at: number, item: AgentConversationItem): void => {
    stream.items[at] = item
    if (stream !== top) grown.add(stream)
    else if (at < settled) changed.add(at)
  }

  // Put the turn's context figure on the line that closes it. Positional rather than by turn id,
  // because a `turn_completed` often has no turn id to match on: the Codex driver clears the current
  // turn before it emits the event (server/drivers/codexDriver.ts), so the completion arrives
  // unattributed. What "the context at that point" means is anyway where the reader is looking, and the
  // usage card above the closing line is the last one before it.
  //
  // Only the session's own stream, which is where every usage event lands: `subagentIdOf` does not
  // attribute one, and a subagent reports its own tokens on its roster card instead. A late usage
  // update, one that arrives after the turn is complete, folds into the card it is updating, so the
  // lines that card already stamped are stamped again.
  const stamp = (at: number): void => {
    const card = top.usageCardAt === undefined ? undefined : top.items[top.usageCardAt].event
    if (card?.type !== 'usage' || card.usage.contextUsed === undefined) return
    const { contextUsed: used, contextSize: size } = card.usage
    const item = top.items[at]
    if (item.context?.used === used && item.context.size === size) return
    write(top, at, { ...item, context: { used, ...(size === undefined ? {} : { size }) } })
  }
  const restamp = (): void => {
    for (const at of closedSinceUsage) stamp(at)
  }

  // Tools, usage, subagents, and plans report evolving state rather than separate moments, so each is
  // folded into the card it started rather than appended. The ledger stores a row per update for
  // usage, subagents and plans. A tool call or a file change it stores as the opening row and one row
  // with the latest state, which folds here to the same card (../../server/sessions/ledgerFold.ts). A
  // plan is a complete snapshot and folds only within its own turn; a later turn's plan is a separate
  // piece of work.
  //
  // A tool call is keyed by turn and tool id, so a command reads as one panel whose status and output
  // change in place. Plans are keyed by turn. Usage is keyed by turn, with one allowance: a turn's last
  // usage update can arrive after the turn is marked complete, which leaves it with no turn id, and it
  // belongs to the line it is updating. That trailing update is how a cost reaches a line that started
  // with only a context count, which used to render as a second, near-identical line. A subagent folds
  // like a tool call, by id, so a completion summary lands on the card the spawn opened.
  //
  // Which existing card this record updates, and in which stream. `undefined` means it opens a new one.
  const foldTarget = (
    record: AgentEventRecord,
    stream: Stream,
  ): { stream: Stream; at: number } | undefined => {
    if (record.event.type === 'tool') return toolCards.get(toolCardKey(record.turnId, record.event.tool.id))
    if (record.event.type === 'file_change') {
      const key = fileChangeKey(record)
      return key === undefined ? undefined : fileChangeCards.get(key)
    }
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

  const add = (record: AgentEventRecord): void => {
    const owner = subagentIdOf(record.event)
    // An orphan stays visible at the top rather than being dropped: the subagent card is normally the
    // event before its first child, but a truncated replay can start mid-stream.
    const stream = (owner ? streams.get(owner) : undefined) ?? top
    const fold = foldTarget(record, stream)
    if (fold) {
      const card = fold.stream.items[fold.at]
      if (record.event.type === 'usage') lastUsage = { at: fold.at, before: card }
      if (record.seq <= card.lastSeq) return
      write(fold.stream, fold.at, foldInto(card, record))
      if (record.event.type === 'usage') restamp()
      return
    }
    if (record.event.type === 'tool') {
      toolCards.set(toolCardKey(record.turnId, record.event.tool.id), { stream, at: stream.items.length })
    }
    const changeKey = fileChangeKey(record)
    if (changeKey !== undefined) fileChangeCards.set(changeKey, { stream, at: stream.items.length })
    if (record.event.type === 'usage') {
      stream.usageCardAt = stream.items.length
      closedSinceUsage = []
      lastUsage = { at: stream.items.length, before: undefined }
    }
    if (record.event.type === 'plan' && record.turnId !== null) {
      stream.planCardAtByTurn.set(record.turnId, stream.items.length)
    }

    const last = stream.items.length - 1
    const previous = stream.items[last]
    if (
      previous
      && previous.turnId === record.turnId
      && isAppendable(previous.event)
      && isAppendable(record.event)
      && previous.event.type === record.event.type
      && record.event.append
      && previous.event.messageId === record.event.messageId
    ) {
      write(stream, last, {
        ...previous,
        lastSeq: record.seq,
        event: { ...previous.event, text: previous.event.text + record.event.text },
      })
      return
    }

    const at = stream.items.length
    const item = openItem(record)
    // A subagent card owns a stream, and `settle` hands the card a copy of that stream's items, so
    // everything the subagent does afterwards appears inside the card without another pass over the
    // transcript.
    if (record.event.type === 'subagent') {
      const child = newStream(at)
      streams.set(record.event.subagent.id, child)
      subagentCardAt.set(record.event.subagent.id, at)
      item.children = []
      grown.add(child)
    }
    write(stream, at, item)
    if (stream === top && record.event.type === 'turn_completed') {
      closedSinceUsage.push(at)
      stamp(at)
    }
  }

  // The store merges a streamed usage update into the line's record in place rather than adding a row
  // (managedStore.ts § foldUsage). The record keeps its id and seq, so it lands where it landed before:
  // this runs the same decision `add` made for it, against the card as it was before it.
  const replaceLastUsage = (record: AgentEventRecord): void => {
    if (!lastUsage) return
    const { at, before } = lastUsage
    if (before && record.seq <= before.lastSeq) return
    write(top, at, before ? foldInto(before, record) : openItem(record))
    restamp()
  }

  const settle = () => {
    for (const stream of grown) {
      const at = stream.cardAt!
      write(top, at, { ...top.items[at], children: stream.items.slice() })
    }
    grown.clear()
    const out = { items: top.items, changed: [...changed] }
    changed.clear()
    settled = top.items.length
    return out
  }

  return { add, replaceLastUsage, settle }
}

// Scoped by turn like a tool card's key, because a harness's item ids need only be unique within one.
const fileChangeKey = (record: AgentEventRecord): string | undefined =>
  record.event.type === 'file_change' && record.event.changeId !== undefined
    ? toolCardKey(record.turnId, `${record.event.changeId}\n${record.event.path ?? ''}`)
    : undefined

const bySeq = (events: AgentEventRecord[]): AgentEventRecord[] => [...events].sort((a, b) => a.seq - b.seq)

export function buildConversationItems(events: AgentEventRecord[]): AgentConversationItem[] {
  const fold = openFold()
  // Copied and sorted unconditionally, and left that way after measuring it: on a 1,850-row session
  // both this and an in-order check that would skip it come in around 0.05 ms, because V8's sort walks
  // an already-ordered array in one pass. Guarding it buys nothing worth a branch.
  for (const record of bySeq(events)) fold.add(record)
  return fold.settle().items
}

/**
 * The projection a streaming transcript keeps, as a function of the session's event array.
 *
 * A long session is tens of thousands of rows, and rebuilding the whole projection for each streamed
 * event cost a few milliseconds each time, 25 times a second. So this keeps the fold open and adds the
 * rows that arrived since the last call, which is the same fold a rebuild runs, fed the same records
 * in the same order.
 *
 * That only holds while the rows it already took are still there, in the same places, and the new ones
 * come after them. So this checks every one of them by identity, which costs a pointer comparison a row,
 * and that the new rows are in seq order. The one in-place change it takes is the store's own: a
 * streamed usage update merged into the line's record (managedStore.ts § foldUsage). Anything else
 * rebuilds from the start: a row seated behind the tail, or a re-read that replaced a record.
 *
 * An item nothing touched is handed back as the same object as last time, which is what lets the
 * transcript's rows tell which card changed. A rebuild hands back new objects throughout, and that is
 * deliberate: it happens when rows landed behind the tail, which is exactly when a card can hold new
 * content under the same key and the same seqs, so there is no cheap way to tell which cards are
 * unchanged. It costs one redraw of every card's bindings, on a reconnect or a late frame.
 */
export function createConversationProjection(): (events: AgentEventRecord[]) => AgentConversationItem[] {
  let fold: Fold | undefined
  // The records the fold has taken, in the order it took them, and where the last usage record sits.
  let taken: AgentEventRecord[] = []
  let lastUsageAt = -1
  let shown: AgentConversationItem[] = []

  const rebuild = (events: AgentEventRecord[]): AgentConversationItem[] => {
    fold = openFold()
    taken = bySeq(events)
    lastUsageAt = -1
    for (const [at, record] of taken.entries()) {
      fold.add(record)
      if (record.event.type === 'usage') lastUsageAt = at
    }
    shown = fold.settle().items.slice()
    return shown
  }

  return (events) => {
    if (!fold || events.length < taken.length) return rebuild(events)
    let replaced: AgentEventRecord | undefined
    for (let at = 0; at < taken.length; at++) {
      const record = events[at]
      if (record === taken[at]) continue
      if (at !== lastUsageAt || !sameUsageRow(taken[at], record)) return rebuild(events)
      replaced = record
    }
    for (let at = Math.max(taken.length, 1); at < events.length; at++) {
      if (events[at].seq <= events[at - 1].seq) return rebuild(events)
    }

    if (replaced) {
      fold.replaceLastUsage(replaced)
      taken[lastUsageAt] = replaced
    }
    for (let at = taken.length; at < events.length; at++) {
      const record = events[at]
      fold.add(record)
      taken.push(record)
      if (record.event.type === 'usage') lastUsageAt = at
    }
    const { items, changed } = fold.settle()
    if (!changed.length && items.length === shown.length) return shown
    const next = shown.slice()
    for (const at of changed) next[at] = items[at]
    for (let at = shown.length; at < items.length; at++) next.push(items[at])
    shown = next
    return shown
  }
}

// The store's merge keeps the row's id, seq and turn (managedStore.ts § foldUsage). The turn decides
// which card a usage row folds into, so a row that moved turns is not the same row.
const sameUsageRow = (held: AgentEventRecord, now: AgentEventRecord): boolean =>
  now.event.type === 'usage' && held.event.type === 'usage'
  && now.id === held.id && now.seq === held.seq && now.turnId === held.turnId
