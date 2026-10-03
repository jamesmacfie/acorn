import { createRenderEffect, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventRecord, AgentNormalizedEvent, AgentSessionSnapshot, AgentTurn } from '../../contract/wire.ts'
import type { TimelineControls } from '@acorn/plugin-api/ui'

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
// Every time a card's bindings re-read its item, by key.
const woken: string[] = []
vi.mock('./AgentEventCard', () => ({
  // A focusable node tagged with the row's key, so a test can prove a surviving row keeps its own DOM
  // (and the focus and local state that ride on it) when the list around it changes.
  default: (props: { item: { key: string; turnId: string | null }; turn?: AgentTurn }) => {
    drawn.push({ turnId: props.item.turnId, turn: props.turn })
    createRenderEffect(() => woken.push(props.item.key))
    return <div data-item={props.item.key} tabindex={-1}>{props.item.key}</div>
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
  woken.length = 0
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
  it('keeps tool time off the collapsed row after later updates', () => {
    const firstAt = Date.parse('2026-09-25T03:24:18Z')
    const snapshot = {
      session: { id: 's1', title: 'A session', config: {} },
      turns: [],
      events: [
        { ...record(1, 'a', { type: 'tool', tool: { id: 'bash', title: 'Run command', status: 'running' } }), createdAt: firstAt },
        { ...record(2, 'a', { type: 'tool', tool: { id: 'bash', title: '', status: 'completed' } }), createdAt: firstAt + 5000 },
      ],
      requests: [],
    } as unknown as AgentSessionSnapshot

    const host = draw(snapshot)
    const row = host.querySelector<HTMLElement>('.ui-timeline-turn')
    expect(row?.hasAttribute('data-tip-at')).toBe(false)
    expect(row?.hasAttribute('data-tip')).toBe(false)
  })

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

// A streaming session sends about 25 events a second, and each one used to wake every card in the list.
describe('a streamed event reaching the transcript', () => {
  it('wakes only the card whose item it changed', () => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
    const events = [message(1, 'a'), message(2, 'a'), message(3, 'a')]
    const snapshotOf = (list: AgentEventRecord[]) => ({
      session: { id: 's1', title: 'A session', config: {} },
      turns: [turn('a', 0)],
      events: list,
      requests: [],
    }) as unknown as AgentSessionSnapshot
    const [snapshot, setSnapshot] = createSignal(snapshotOf(events))
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => (
      <AgentTranscript taskId="t1" snapshot={snapshot()} onExitSubagent={() => {}} onRequestResolved={() => {}} />
    ), host)
    hosts.push(() => { dispose(); host.remove() })
    woken.length = 0

    // More text for the last message, the way a harness streams it.
    setSnapshot(snapshotOf([...events, record(4, 'a', { type: 'assistant_message', text: ' more', messageId: 'm3', append: true })]))
    expect(woken).toEqual(['e3'])
  })
})

// A long session is drawn through a window (docs/managed-agents/transcript.md § The window):
// the projection covers every event, and the DOM holds the newest page and whatever the reader asked
// for on top of it.
describe('a long transcript', () => {
  const PAGE = 200
  const snapshotOf = (id: string, count: number, extra: AgentEventRecord[] = []) => ({
    session: { id, title: 'A session', config: {} },
    turns: [turn('a', 0)],
    events: [...Array.from({ length: count }, (_, index) => message(index + 1, 'a')), ...extra],
    requests: [],
  }) as unknown as AgentSessionSnapshot
  const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.ui-timeline-turn')]
  const earlier = (host: HTMLElement) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Show earlier'))

  const mount = (snapshot: () => AgentSessionSnapshot, extra: { focusRequestId?: () => string | undefined; onControls?: (api: TimelineControls) => void } = {}) => {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = TestResizeObserver
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => (
      <AgentTranscript
        taskId="t1"
        snapshot={snapshot()}
        focusRequestId={extra.focusRequestId?.()}
        onControls={extra.onControls}
        onExitSubagent={() => {}}
        onRequestResolved={() => {}}
      />
    ), host)
    hosts.push(() => { dispose(); host.remove() })
    return host
  }

  it('draws the newest page, says how many cards it hides, and numbers each in the whole session', () => {
    const host = mount(() => snapshotOf('s1', 1000))
    expect(rows(host)).toHaveLength(PAGE)
    expect(rows(host)[0]?.dataset.turn).toBe('e801')
    expect(rows(host)[0]?.getAttribute('aria-posinset')).toBe('801')
    expect(rows(host)[0]?.getAttribute('aria-setsize')).toBe('1000')
    expect(earlier(host)?.textContent).toBe('Show earlier (800)')
  })

  it('starts another session on its own newest page, however far back the reader went in this one', () => {
    const [snapshot, setSnapshot] = createSignal(snapshotOf('s1', 1000))
    const host = mount(snapshot)
    earlier(host)!.click()
    expect(rows(host)).toHaveLength(2 * PAGE)
    setSnapshot(snapshotOf('s2', 900))
    expect(rows(host)).toHaveLength(PAGE)
    expect(earlier(host)?.textContent).toBe('Show earlier (700)')
  })

  it('draws a request a notice named, even when it is older than the window', () => {
    const question = record(0, 'a', { type: 'request', requestId: 'q1', kind: 'question', title: 'Which one?' } as AgentNormalizedEvent)
    const events = [question, ...snapshotOf('s1', 1000).events]
    const [focus, setFocus] = createSignal<string>()
    const host = mount(() => ({ ...snapshotOf('s1', 0), events }) as AgentSessionSnapshot, { focusRequestId: focus })
    expect(host.querySelector('[data-item="e0"]')).toBeNull()
    setFocus('q1')
    expect(host.querySelector('[data-item="e0"]')).not.toBeNull()
  })

  it('draws every card when the reader goes to the top, which is the oldest turn', () => {
    let api: TimelineControls | undefined
    const host = mount(() => snapshotOf('s1', 1000), { onControls: (next) => { api = next } })
    api!.toTop()
    expect(rows(host)).toHaveLength(1000)
    expect(earlier(host)).toBeUndefined()
  })

  it('keeps a selection across two cards while the newest one streams', () => {
    const events = Array.from({ length: 300 }, (_, index) => message(index + 1, 'a'))
    const [snapshot, setSnapshot] = createSignal(snapshotOf('s1', 0, events))
    const host = mount(snapshot)
    const first = host.querySelector('[data-item="e150"]')!.firstChild!
    const second = host.querySelector('[data-item="e151"]')!.firstChild!
    const range = document.createRange()
    range.setStart(first, 1)
    range.setEnd(second, 2)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    const selected = document.getSelection()!.toString()

    setSnapshot(snapshotOf('s1', 0, [...events, record(301, 'a', { type: 'assistant_message', text: ' more', messageId: 'm300', append: true })]))
    expect(first.isConnected && second.isConnected).toBe(true)
    expect(document.getSelection()!.toString()).toBe(selected)
    document.getSelection()!.removeAllRanges()
  })
})
