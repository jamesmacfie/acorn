import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'
import type { AgentSessionSnapshot } from '@acorn/protocol/managedAgents.ts'
import AgentEventCard from './AgentEventCard'
import AgentRequestCard from './AgentRequestCard'
import { buildConversationItems } from './conversationItems'
import { EmptyState } from '@acorn/plugin-api/ui'

const VISIBLE_EVENT_TYPES = new Set([
  'user_message',
  'assistant_message',
  'reasoning',
  'tool',
  'plan',
  'usage',
  'file_change',
  'terminal',
  'artifact',
  'turn_completed',
  'error',
  'diagnostic',
])

// Deliberately NOT virtualized. The virtualizer this used to run called `measure()` on every new event,
// which CLEARS the item size cache — so every row fell back to the size estimate, the canvas height
// jumped, and the rows re-measured, on every event. It also had to rebuild rows from `getVirtualItems()`,
// which returns fresh objects on each scroll and re-measure, replacing the DOM under any selection.
//
// ponytail: plain DOM, no cap. Fine for the few hundred cards a real session holds; if one ever feels
// slow to open, render only the last N behind a "show earlier" control — a fixed window with no
// measurement feedback loop — rather than restoring a measuring virtualizer.
export default function AgentTranscript(props: {
  taskId: string
  snapshot: AgentSessionSnapshot
  focusRequestId?: string
  onRequestResolved: () => void
}) {
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>()
  const items = createMemo(() =>
    buildConversationItems(props.snapshot.events).filter((item) => VISIBLE_EVENT_TYPES.has(item.event.type)))
  const pending = createMemo(() => props.snapshot.requests.filter((request) =>
    request.status === 'pending' || request.status === 'resolving'))
  // Appending an event and growing the last event's text are both worth following down; nothing else
  // about a snapshot should move the scroll position.
  const tail = createMemo(() => {
    const last = items().at(-1)
    return `${items().length}:${last?.lastSeq ?? 0}`
  })

  let wasNearBottom = true
  let frame = 0
  const noteScroll = () => {
    const element = scrollElement()
    if (!element) return
    wasNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }
  // Follow the tail only while the reader is already at the tail. Scrolling up to read (or to select)
  // is a decision to stop following, so the next event must not yank the viewport back down.
  createEffect(on(tail, () => {
    if (!wasNearBottom) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const element = scrollElement()
      if (element) element.scrollTop = element.scrollHeight
    })
  }, { defer: true }))
  onCleanup(() => cancelAnimationFrame(frame))

  return (
    <div class="agent-transcript-wrap">
      <Show when={pending().length}>
        <div class="agent-pending-requests" aria-label="Agent requests requiring attention">
          <For each={pending()}>
            {(request) => (
              <AgentRequestCard
                request={request}
                focused={request.providerRequestId === props.focusRequestId}
                onResolved={props.onRequestResolved}
              />
            )}
          </For>
        </div>
      </Show>
      <div class="agent-transcript" ref={setScrollElement} onScroll={noteScroll}>
        <Show
          when={items().length}
          fallback={
            <EmptyState icon={<span class="agent-empty-mark">✦</span>}>
              This session is ready for its first turn.
            </EmptyState>
          }
        >
          <div class="agent-transcript-list">
            {/*
              `Index`, not `For`: buildConversationItems rebuilds every item object on every snapshot, and
              `For` keys by reference, so it would recreate the whole list on each streamed event and take
              any in-progress selection with it. Position-keyed rows keep their DOM.
            */}
            <Index each={items()}>
              {(item) => (
                <AgentEventCard
                  item={item()}
                  taskId={props.taskId}
                  turn={props.snapshot.turns.find((turn) => turn.id === item().turnId)}
                />
              )}
            </Index>
          </div>
        </Show>
      </div>
    </div>
  )
}
