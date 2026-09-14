import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventRecord, AgentNormalizedEvent, AgentSessionSnapshot, AgentTurn } from '@acorn/protocol/managedAgents.ts'

// How a row finds its turn.
//
// The row body used to call `props.snapshot.turns.find(...)`, which is rows times turns on every
// render of the list — and the list re-renders about 25 times a second while a session streams. One
// memoized map above the `Index` answers the same question once per turn.

vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ setQueryData: () => {} }),
}))

const drawn: { turnId: string | null; turn: AgentTurn | undefined }[] = []
vi.mock('./AgentEventCard', () => ({
  // A focusable node tagged with the row's key, so a test can prove a surviving row keeps its own DOM
  // (and the focus and local state that ride on it) when the list around it changes.
  default: (props: { item: { key: string; turnId: string | null }; turn?: AgentTurn }) => {
    drawn.push({ turnId: props.item.turnId, turn: props.turn })
    return <div data-item={props.item.key} tabindex={-1} />
  },
}))

const { default: AgentTranscript } = await import('./AgentTranscript')

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

const turn = (id: string, ordinal: number): AgentTurn => ({
  id,
  sessionId: 's1',
  ordinal,
  source: 'interactive',
  status: 'completed',
  input: [],
  effectivePolicy: {},
  providerTurnRef: null,
  stopReason: null,
  usage: null,
  error: null,
  attempt: 0,
  createdAt: ordinal,
  startedAt: null,
  completedAt: null,
})

const record = (seq: number, turnId: string, event: AgentNormalizedEvent): AgentEventRecord => ({
  id: `e${seq}`,
  sessionId: 's1',
  turnId,
  seq,
  schemaVersion: 1,
  event,
  searchText: null,
  createdAt: seq,
})

const message = (seq: number, turnId: string): AgentEventRecord =>
  record(seq, turnId, { type: 'assistant_message', text: `line ${seq}`, messageId: `m${seq}` })

const hosts: Array<() => void> = []
afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  drawn.length = 0
})

const draw = (snapshot: AgentSessionSnapshot) => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => (
    <AgentTranscript
      taskId="t1"
      snapshot={snapshot}
      onExitSubagent={() => {}}
      onRequestResolved={() => {}}
    />
  ), host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

describe('a transcript row finding its turn', () => {
  it('resolves through the map and never scans the turn list', () => {
    // An own `find` shadows the prototype's, so anything still scanning shows up here.
    const scan = vi.fn()
    const turns = Object.assign([turn('a', 0), turn('b', 1)], { find: scan })
    const snapshot = {
      session: { id: 's1', title: 'A session', config: {} },
      turns,
      events: [message(1, 'a'), message(2, 'b'), message(3, 'b')],
      requests: [],
    } as unknown as AgentSessionSnapshot

    draw(snapshot)

    expect(scan).not.toHaveBeenCalled()
    expect(drawn.map((row) => row.turn?.id)).toEqual(['a', 'b', 'b'])
    expect(drawn.every((row) => row.turn?.id === row.turnId)).toBe(true)
  })

  it('hands a row with no turn nothing, rather than the first turn', () => {
    const snapshot = {
      session: { id: 's1', title: 'A session', config: {} },
      turns: [turn('a', 0)],
      // A turn-less event: a session-level error or a trailing usage update.
      events: [{ ...message(1, 'a'), turnId: null }],
      requests: [],
    } as unknown as AgentSessionSnapshot

    draw(snapshot)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].turn).toBeUndefined()
  })
})

// Rows are keyed by the projection's stable id, not by their place in the list. A row that survives a
// filter keeps its own DOM node, so the focus and local state riding on it stay with the right item
// instead of transferring to whatever the array position now holds (docs/future/scoll_fix.md § Positional
// rows retain the wrong identity).
describe('a surviving transcript row keeping its identity', () => {
  const item = (host: HTMLElement, key: string) =>
    host.querySelector<HTMLElement>(`[data-item="${key}"]`)

  it('keeps focus on a row when an earlier row is filtered out', () => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
    const [chatsOnly, setChatsOnly] = createSignal(false)
    const snapshot = {
      session: { id: 's1', title: 'A session', config: {} },
      turns: [turn('a', 0)],
      events: [
        record(1, 'a', { type: 'user_message', text: 'ask' }),
        record(2, 'a', { type: 'reasoning', text: 'think', messageId: 'm2' }),
        record(3, 'a', { type: 'user_message', text: 'again' }),
      ],
      requests: [],
    } as unknown as AgentSessionSnapshot

    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => (
      <AgentTranscript
        taskId="t1"
        snapshot={snapshot}
        chatsOnly={chatsOnly()}
        onExitSubagent={() => {}}
        onRequestResolved={() => {}}
      />
    ), host)
    hosts.push(() => { dispose(); host.remove() })

    // The reader is on the last message, third in the list.
    const before = item(host, 'e3')!
    before.focus()
    expect(document.activeElement).toBe(before)

    // Chats-only drops the reasoning row between them, so the last message is now second. By position it
    // moved; by identity it did not.
    setChatsOnly(true)
    expect(item(host, 'e2')).toBeNull()
    expect(item(host, 'e3')).toBe(before)
    expect(document.activeElement).toBe(before)
  })
})
