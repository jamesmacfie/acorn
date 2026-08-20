import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'
import { onScopeEvicted } from '@acorn/plugin-api/client'
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

// Deliberately not virtualized. The virtualizer this used to run called `measure()` on every new event,
// which clears the item size cache, so every row fell back to the size estimate, the canvas height
// jumped, and the rows re-measured, on every event. It also rebuilt rows from `getVirtualItems()`,
// which returns fresh objects on each scroll and re-measure, replacing the DOM under any selection.
//
// Plain DOM, no cap. Fine for the few hundred cards a real session holds. If one ever feels slow to
// open, render only the last N behind a "show earlier" control, which is a fixed window with no
// measurement feedback loop, rather than restoring a measuring virtualizer.

// A plain Map, in memory for the life of the window. Scroll position is worth remembering across a pane
// unmount, not worth a store or a round trip to disk. Cleared with the roster it keys off, so a node
// switch can't leave positions behind for sessions that are gone.
const scrollTopBySession = new Map<string, number>()
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') scrollTopBySession.clear()
})

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

  const sessionId = createMemo(() => props.snapshot.session.id)

  let wasNearBottom = true
  let frame = 0
  let target: number | null = null
  let applied = -1
  const nearBottom = (element: HTMLDivElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight < 96
  const noteScroll = () => {
    const element = scrollElement()
    if (!element) return
    // Our own restore write echoes back as a scroll event; a real scroll ends the restore.
    if (element.scrollTop === applied) return
    target = null
    wasNearBottom = nearBottom(element)
    scrollTopBySession.set(sessionId(), element.scrollTop)
  }
  // Leaving the task unmounts this pane, so the reader must land back where they were. Code highlighting
  // resolves after mount and keeps growing the list, so the browser clamps an early write. Re-apply the
  // target until it sticks, driven by the list's own resizes.
  const applyTarget = () => {
    const element = scrollElement()
    if (!element || target === null) return
    element.scrollTop = target
    applied = element.scrollTop
    if (element.scrollTop < target - 1) return
    target = null
    wasNearBottom = nearBottom(element)
  }
  const growth = new ResizeObserver(applyTarget)
  onCleanup(() => growth.disconnect())
  // Switching sessions in the sidebar swaps the snapshot without remounting, so this covers both mount
  // and session change.
  createEffect(on(sessionId, (id) => {
    target = scrollTopBySession.get(id) ?? null
    wasNearBottom = target === null
    applyTarget()
  }))
  // Follow the tail only while the reader is already at the tail. Scrolling up to read, or to select, is
  // a decision to stop following, so the next event must not yank the viewport back down.
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
          <div class="agent-transcript-list" ref={(element) => growth.observe(element)}>
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
