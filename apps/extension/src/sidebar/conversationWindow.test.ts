import { describe, expect, it } from 'vitest'
import type { BridgeConversationRecord, BridgeSessionRead } from '@acorn/protocol/extensionBridge.ts'
import { settle } from '../test/fakeBrowser'
import { CONVERSATION_PAGE, conversationItems, conversationReader, type ConversationWindow } from './conversationWindow'

const record = (
  seq: number,
  event: BridgeConversationRecord['event'],
  extra: Partial<BridgeConversationRecord> = {},
): BridgeConversationRecord => ({ id: `e${seq}`, seq, turnId: 't1', createdAt: seq, event, ...extra })

describe('conversation items', () => {
  it('joins a streamed message and folds a tool call into one line', () => {
    expect(
      conversationItems([
        record(1, { type: 'user_message', text: 'Fix the test' }),
        record(2, { type: 'tool', toolId: 'a', title: 'Run tests', status: 'running' }),
        record(3, { type: 'assistant_message', text: 'Look', messageId: 'm' }),
        record(4, { type: 'assistant_message', text: 'ing.', messageId: 'm', append: true }),
        record(5, { type: 'tool', toolId: 'a', status: 'completed' }),
        record(6, { type: 'error', message: 'Out of credit' }),
      ]),
    ).toEqual([
      { key: 'e1', kind: 'you', text: 'Fix the test', attachments: [] },
      { key: 'e2', kind: 'tool', title: 'Run tests', status: 'completed' },
      { key: 'e3', kind: 'agent', text: 'Looking.' },
      { key: 'e6', kind: 'error', text: 'Out of credit' },
    ])
  })

  it('skips an update a folded record already holds', () => {
    const items = conversationItems([
      record(1, { type: 'tool', toolId: 'a', title: 'Build', status: 'completed' }, { foldedThroughSeq: 4 }),
      record(3, { type: 'tool', toolId: 'a', status: 'running' }),
    ])
    expect(items).toEqual([{ key: 'e1', kind: 'tool', title: 'Build', status: 'completed' }])
  })
})

// A session of `last` events, every one a user message, read the way the host pages it.
function ledger(last: number) {
  const state = { last, reads: [] as number[], hold: null as Promise<void> | null }
  const read = async (afterSeq: number, limit: number): Promise<BridgeSessionRead> => {
    state.reads.push(afterSeq)
    await state.hold
    const records = []
    for (let seq = afterSeq + 1; seq <= Math.min(state.last, afterSeq + limit); seq++)
      records.push(record(seq, { type: 'user_message', text: `m${seq}` }))
    return {
      nodeId: 'n',
      sessionId: 's',
      session: {
        id: 's',
        taskId: 't',
        title: 'Chat',
        providerId: 'p',
        profileId: 'p',
        kind: 'interactive',
        runtimeState: 'ready',
        attention: 'none',
        lastEventSeq: state.last,
        archivedAt: null,
        updatedAt: 1,
      },
      records,
      reach: records.at(-1)?.seq ?? afterSeq,
      queued: [],
      requests: [],
    }
  }
  return { state, read }
}

function reader(last: number, startAt = last) {
  const { state, read } = ledger(last)
  const views: ConversationWindow[] = []
  const subject = conversationReader({
    read,
    lastEventSeq: startAt,
    changed: (view) => views.push(view),
    failed: (error) => {
      throw error
    },
  })
  const seqs = () => views.at(-1)!.records.map((row) => row.seq)
  return { state, subject, views, seqs }
}

describe('conversation reader', () => {
  it('opens on the last page and reads earlier pages on request', async () => {
    const last = CONVERSATION_PAGE * 2 + 50
    const { state, subject, views, seqs } = reader(last)
    await subject.refresh()
    expect(state.reads).toEqual([last - CONVERSATION_PAGE])
    expect(seqs()[0]).toBe(last - CONVERSATION_PAGE + 1)
    await subject.earlier()
    await subject.earlier()
    expect(views.at(-1)!.from).toBe(0)
    expect(seqs()).toEqual(Array.from({ length: last }, (_, index) => index + 1))
  })

  it('reads on from its end, and folds calls made during a read into one more', async () => {
    const { state, subject, seqs } = reader(10)
    await subject.refresh()
    state.last = 12
    let release!: () => void
    state.hold = new Promise((resolve) => (release = resolve))
    void subject.refresh()
    void subject.refresh()
    void subject.refresh()
    release()
    await settle()
    expect(state.reads).toEqual([0, 10, 12])
    expect(seqs()).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
  })

  it('jumps to the end after falling far behind, rather than walking every page', async () => {
    const { state, subject, views, seqs } = reader(10)
    await subject.refresh()
    state.last = 10 + CONVERSATION_PAGE * 5
    await subject.refresh()
    expect(state.reads).toEqual([0, 10, state.last - CONVERSATION_PAGE])
    expect(views.at(-1)!.from).toBe(state.last - CONVERSATION_PAGE)
    expect(seqs()).toHaveLength(CONVERSATION_PAGE)
  })

  it('applies nothing after it is disposed', async () => {
    const { state, subject, views } = reader(10)
    let release!: () => void
    state.hold = new Promise((resolve) => (release = resolve))
    void subject.refresh()
    subject.dispose()
    release()
    await settle()
    expect(views).toEqual([])
  })
})
