import type {
  BridgeAgentSession,
  BridgeAttachmentRef,
  BridgeConversationRecord,
  BridgeSessionRead,
  BridgeToolCard,
} from '@acorn/protocol/extensionBridge.ts'

// One conversation as the sidebar holds it: a window of the session's events, from `from` (exclusive)
// to `reach`, never the whole transcript. Opening reads the last page; Earlier reads the page below.

// Events per read, and how far behind the end the window may fall before it jumps to the end again.
export const CONVERSATION_PAGE = 200

export type ToolLine = { key: string; kind: 'tool'; title: string; status: string | null }
// A panel or app the agent made, named on a line of its own. `toolId` names the call to the host.
export type CardLine = { key: string; kind: 'card'; toolId: string; card: BridgeToolCard; status: string | null }

// A run this long or longer folds into one line. Two lines read as quickly as a folded one would.
const TOOL_FOLD_AT = 3

// `at` is when the Node recorded the message. `workflow` marks a workflow step's prompt, which the
// person didn't write.
export type ConversationItem =
  | { key: string; kind: 'you'; text: string; attachments: BridgeAttachmentRef[]; at: number; workflow: boolean }
  | { key: string; kind: 'agent'; text: string; at: number }
  | { key: string; kind: 'error'; text: string }
  | ToolLine
  | CardLine
  // A run of tool lines with nothing between them. Its key is its first line's, so it stays the same
  // run as later lines join it.
  | { key: string; kind: 'tools'; lines: ToolLine[] }

// A call's card fields merge as its title and status do: a field a record leaves out is unchanged.
const mergeCard = (card: BridgeToolCard | undefined, update: BridgeToolCard | undefined) =>
  card && update?.kind === card.kind ? ({ ...card, ...update } as BridgeToolCard) : (update ?? card)

// A card line needs something to name, so an opener whose input didn't parse reads as the tool line it
// would have been. A call that failed its checks always gets its line, so a failure never reads as done.
const named = (card: BridgeToolCard) =>
  card.failed || (card.kind === 'panel' ? !!card.title : !!(card.name || card.appId))

// Messages, tool summaries, and errors in seq order. A streamed message arrives as appends on one
// message id and reads as one message. A tool call arrives as an opener and later updates on one id,
// and reads as one line whose title, status, and card keep the last value reported; a field an update
// leaves out is unchanged. An update at or below the seq a folded record already covers is skipped, so
// a record read twice can't apply twice. A named card is a `card` item, which no run folds. Runs of
// TOOL_FOLD_AT or more tool lines come back as one `tools` item.
export function conversationItems(records: readonly BridgeConversationRecord[]): ConversationItem[] {
  const items: ConversationItem[] = []
  const tools = new Map<string, { at: number; toolId: string; through: number; card: BridgeToolCard | undefined }>()
  let message: { at: number; turnId: string | null; messageId: string | undefined } | null = null
  for (const record of records) {
    const event = record.event
    if (event.type === 'assistant_message') {
      const previous = message && items[message.at]
      if (
        event.append &&
        previous?.kind === 'agent' &&
        message!.turnId === record.turnId &&
        message!.messageId === event.messageId
      ) {
        items[message!.at] = { ...previous, text: previous.text + event.text }
        continue
      }
      message = { at: items.length, turnId: record.turnId, messageId: event.messageId }
      items.push({ key: record.id, kind: 'agent', text: event.text, at: record.createdAt })
      continue
    }
    message = null
    if (event.type === 'user_message')
      items.push({
        key: record.id,
        kind: 'you',
        text: event.text,
        attachments: event.attachments ?? [],
        at: record.createdAt,
        workflow: event.workflow ?? false,
      })
    else if (event.type === 'error') items.push({ key: record.id, kind: 'error', text: event.message })
    else {
      const toolKey = `${record.turnId ?? 'session'}:${event.toolId}`
      const through = record.foldedThroughSeq ?? record.seq
      const open = tools.get(toolKey)
      const line = open && items[open.at]
      if (open && line?.kind === 'tool') {
        if (record.seq <= open.through) continue
        items[open.at] = { ...line, title: event.title || line.title, status: event.status ?? line.status }
        open.through = through
        open.card = mergeCard(open.card, event.card)
        continue
      }
      tools.set(toolKey, { at: items.length, toolId: event.toolId, through, card: event.card })
      items.push({ key: record.id, kind: 'tool', title: event.title || 'Tool call', status: event.status ?? null })
    }
  }
  // After every record, because a call's card fields can arrive in any of them.
  for (const { at, toolId, card } of tools.values()) {
    const line = items[at]
    if (card && named(card) && line?.kind === 'tool')
      items[at] = { key: line.key, kind: 'card', toolId, card, status: line.status }
  }
  return groupToolRuns(items)
}

// After the fold above, because an update can change a line anywhere in the list.
function groupToolRuns(items: ConversationItem[]): ConversationItem[] {
  const grouped: ConversationItem[] = []
  let run: ToolLine[] = []
  const endRun = () => {
    if (run.length >= TOOL_FOLD_AT) grouped.push({ key: run[0]!.key, kind: 'tools', lines: run })
    else grouped.push(...run)
    run = []
  }
  for (const item of items) {
    if (item.kind === 'tool') run.push(item)
    else {
      endRun()
      grouped.push(item)
    }
  }
  endRun()
  return grouped
}

export type ConversationWindow = {
  session: BridgeAgentSession | null
  records: BridgeConversationRecord[]
  from: number
  reach: number
  queued: BridgeSessionRead['queued']
  // The Node's requests as of the last read. Their state is read whole each time, not folded.
  requests: BridgeSessionRead['requests']
}

const bySeq = (records: BridgeConversationRecord[]) => {
  const unique = new Map(records.map((record) => [record.id, record]))
  return [...unique.values()].sort((left, right) => left.seq - right.seq)
}

// Reads one session into a window. `refresh` reads on from the window's end and is safe to call as
// often as hints arrive: calls made while a read is out run once more after it, not once each.
// `earlier` reads the page below the window. Nothing applies after `dispose`, so a reply for a
// session the sidebar has left can't land in the one it shows now.
export function conversationReader(options: {
  read(afterSeq: number, limit: number): Promise<BridgeSessionRead>
  // Where to start: the session's last seq, as its list row knew it.
  lastEventSeq: number
  changed(window: ConversationWindow): void
  failed(error: unknown): void
}) {
  const start = Math.max(0, options.lastEventSeq - CONVERSATION_PAGE)
  let window: ConversationWindow = { session: null, records: [], from: start, reach: start, queued: [], requests: [] }
  let disposed = false
  let reading = false
  let again = false
  let loadingEarlier = false

  const apply = (next: ConversationWindow) => {
    window = next
    options.changed(window)
  }

  async function readToEnd(): Promise<void> {
    for (;;) {
      const page = await options.read(window.reach, CONVERSATION_PAGE)
      if (disposed) return
      const end = page.session.lastEventSeq
      // Far behind, say after a long disconnect: start again at the end rather than walk every page.
      if (end - page.reach > CONVERSATION_PAGE) {
        const tail = end - CONVERSATION_PAGE
        apply({
          session: page.session,
          records: [],
          from: tail,
          reach: tail,
          queued: page.queued,
          requests: page.requests,
        })
        continue
      }
      const progressed = page.reach > window.reach
      apply({
        session: page.session,
        records: page.records.length ? bySeq([...window.records, ...page.records]) : window.records,
        from: window.from,
        reach: Math.max(window.reach, page.reach),
        queued: page.queued,
        requests: page.requests,
      })
      if (!progressed || window.reach >= end) return
    }
  }

  return {
    async refresh(): Promise<void> {
      if (reading) {
        again = true
        return
      }
      reading = true
      try {
        do {
          again = false
          await readToEnd()
        } while (again && !disposed)
      } catch (error) {
        if (!disposed) options.failed(error)
      } finally {
        reading = false
      }
    },
    async earlier(): Promise<void> {
      if (loadingEarlier || window.from === 0) return
      loadingEarlier = true
      const below = window.from
      const from = Math.max(0, below - CONVERSATION_PAGE)
      try {
        const page = await options.read(from, CONVERSATION_PAGE)
        // A jump to the end while this was out moved the window; this page no longer joins it.
        if (disposed || window.from !== below) return
        const older = page.records.filter((record) => record.seq <= below)
        apply({ ...window, records: bySeq([...older, ...window.records]), from })
      } catch (error) {
        if (!disposed) options.failed(error)
      } finally {
        loadingEarlier = false
      }
    },
    dispose() {
      disposed = true
    },
  }
}
