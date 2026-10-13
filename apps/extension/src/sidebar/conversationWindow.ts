import type {
  BridgeAgentSession,
  BridgeAttachmentRef,
  BridgeConversationRecord,
  BridgeSessionRead,
} from '@acorn/protocol/extensionBridge.ts'

// One conversation as the sidebar holds it: a window of the session's events, from `from` (exclusive)
// to `reach`, never the whole transcript. Opening reads the last page; Earlier reads the page below.

// Events per read, and how far behind the end the window may fall before it jumps to the end again.
export const CONVERSATION_PAGE = 200

export type ConversationItem =
  | { key: string; kind: 'you'; text: string; attachments: BridgeAttachmentRef[] }
  | { key: string; kind: 'agent' | 'error'; text: string }
  | { key: string; kind: 'tool'; title: string; status: string | null }

// Messages, tool summaries, and errors in seq order. A streamed message arrives as appends on one
// message id and reads as one message. A tool call arrives as an opener and later updates on one id,
// and reads as one line whose title and status keep the last value reported; a field an update leaves
// out is unchanged. An update at or below the seq a folded record already covers is skipped, so a
// record read twice can't apply twice.
export function conversationItems(records: readonly BridgeConversationRecord[]): ConversationItem[] {
  const items: ConversationItem[] = []
  const tools = new Map<string, { at: number; through: number }>()
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
      items.push({ key: record.id, kind: 'agent', text: event.text })
      continue
    }
    message = null
    if (event.type === 'user_message')
      items.push({ key: record.id, kind: 'you', text: event.text, attachments: event.attachments ?? [] })
    else if (event.type === 'error') items.push({ key: record.id, kind: 'error', text: event.message })
    else {
      const toolKey = `${record.turnId ?? 'session'}:${event.toolId}`
      const through = record.foldedThroughSeq ?? record.seq
      const open = tools.get(toolKey)
      const card = open && items[open.at]
      if (open && card?.kind === 'tool') {
        if (record.seq <= open.through) continue
        items[open.at] = { ...card, title: event.title || card.title, status: event.status ?? card.status }
        open.through = through
        continue
      }
      tools.set(toolKey, { at: items.length, through })
      items.push({ key: record.id, kind: 'tool', title: event.title || 'Tool call', status: event.status ?? null })
    }
  }
  return items
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
