import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEventRecord, AgentSessionSnapshot, AgentTurn } from '@acorn/protocol/managedAgents.ts'

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
  default: (props: { item: { turnId: string | null }; turn?: AgentTurn }) => {
    drawn.push({ turnId: props.item.turnId, turn: props.turn })
    return null
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

const message = (seq: number, turnId: string): AgentEventRecord => ({
  id: `e${seq}`,
  sessionId: 's1',
  turnId,
  seq,
  schemaVersion: 1,
  event: { type: 'assistant_message', text: `line ${seq}`, messageId: `m${seq}` },
  searchText: null,
  createdAt: seq,
})

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
