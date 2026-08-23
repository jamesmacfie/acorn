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
//
// Only positions the reader chose are held. A session left at the bottom has no entry, because a pixel
// offset is the wrong thing to save for it: the bottom moves as the session runs, so replaying the offset
// lands short of it and the reader comes back a screenful up from where they left.
const scrollTopBySession = new Map<string, number>()
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') scrollTopBySession.clear()
})

export default function AgentTranscript(props: {
  taskId: string
  snapshot: AgentSessionSnapshot
  focusRequestId?: string
  focusSubagentId?: string
  onRequestResolved: () => void
}) {
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>()
  const items = createMemo(() =>
    buildConversationItems(props.snapshot.events).filter((item) => VISIBLE_EVENT_TYPES.has(item.event.type)))
  const pending = createMemo(() => props.snapshot.requests.filter((request) =>
    request.status === 'pending' || request.status === 'resolving'))
  const sessionId = createMemo(() => props.snapshot.session.id)

  // Follow the bottom until the reader scrolls away from it, and pick it up again when they scroll back.
  // Everything below is driven by the list resizing rather than by the snapshot changing: a streamed
  // message keeps growing after the event that carried it, and code highlighting settles a frame or two
  // later again, so any write timed off the data lands short of a bottom that has since moved.
  let following = true
  let target: number | null = null
  let applied = -1
  const nearBottom = (element: HTMLDivElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight < 96
  const pin = () => {
    const element = scrollElement()
    if (!element) return
    element.scrollTop = element.scrollHeight
    applied = element.scrollTop
    scrollTopBySession.delete(sessionId())
  }
  const noteScroll = () => {
    const element = scrollElement()
    if (!element) return
    // Our own writes echo back as scroll events. Reading near-bottom off one is a trap: the list has
    // usually grown again by the time it arrives, so the write we just made now measures as "scrolled up"
    // and following would switch itself off. Only a scroll we did not make counts.
    if (element.scrollTop === applied) return
    target = null
    following = nearBottom(element)
    if (following) scrollTopBySession.delete(sessionId())
    else scrollTopBySession.set(sessionId(), element.scrollTop)
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
    following = nearBottom(element)
  }
  // The list grows for two reasons and the response differs: while restoring we chase the saved offset,
  // otherwise we sit on the bottom. The scroll element is observed too, because the pending-request strip
  // above it appearing shortens the viewport without touching the list.
  // Where a sidebar sub-row sends the reader. The card may not be in the DOM on the first attempt,
  // because selecting a sub-row under another session loads that session's snapshot first, so the id is
  // held and retried on the list's own resizes alongside the restore.
  let pendingSubagentId: string | null = null
  const focusPendingSubagent = () => {
    const element = scrollElement()
    if (!element || !pendingSubagentId) return
    const card = element.querySelector(`[data-subagent="${CSS.escape(pendingSubagentId)}"]`)
    if (!card) return
    pendingSubagentId = null
    // Jumping to a card is a decision to stop following the tail, the same as scrolling up by hand.
    target = null
    following = false
    card.scrollIntoView({ block: 'start' })
    scrollTopBySession.set(sessionId(), element.scrollTop)
  }
  const growth = new ResizeObserver(() => {
    if (pendingSubagentId) focusPendingSubagent()
    else if (target !== null) applyTarget()
    else if (following) pin()
  })
  onCleanup(() => growth.disconnect())
  // A memo, not an inline getter: `on()` runs its callback on every notification without comparing the
  // input, and the signal behind this prop is one record covering every session's subagent selection,
  // so an inline getter would jump the transcript when a different session's row was clicked.
  const focusSubagentId = createMemo(() => props.focusSubagentId)
  createEffect(on(focusSubagentId, (id) => {
    if (!id) return
    pendingSubagentId = id
    focusPendingSubagent()
  }, { defer: true }))
  // Switching sessions in the sidebar swaps the snapshot without remounting, so this covers both mount
  // and session change.
  createEffect(on(sessionId, (id) => {
    target = scrollTopBySession.get(id) ?? null
    following = target === null
    if (target === null) pin()
    else applyTarget()
  }))

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
      <div
        class="agent-transcript"
        ref={(element) => {
          setScrollElement(element)
          growth.observe(element)
        }}
        onScroll={noteScroll}
      >
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
