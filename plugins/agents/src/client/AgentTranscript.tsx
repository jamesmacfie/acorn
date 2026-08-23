import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'
import { onScopeEvicted } from '@acorn/plugin-api/client'
import type { AgentSessionSnapshot } from '@acorn/protocol/managedAgents.ts'
import AgentEventCard from './AgentEventCard'
import AgentRequestCard from './AgentRequestCard'
import { buildConversationItems, findSubagentItem, visibleConversationItems } from './conversationItems'
import { Button, EmptyState } from '@acorn/plugin-api/ui'
import { subagentSummary } from './subagentDisplay'

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
  onExitSubagent: () => void
  onRequestResolved: () => void
}) {
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>()
  const conversation = createMemo(() => buildConversationItems(props.snapshot.events))
  // The selected subagent's card, when there is one. A complex child run does not fit in a box inside
  // its parent's stream, so selecting it moves the whole window onto that run: the transcript renders
  // the card's own children as its top level, which the projection already built as a tree.
  const focused = createMemo(() => {
    const id = props.focusSubagentId
    return id ? findSubagentItem(conversation(), id) : undefined
  })
  const focusedSubagent = createMemo(() => {
    const event = focused()?.event
    return event?.type === 'subagent' ? event.subagent : undefined
  })
  // Falls back to the session's own stream when the card is not there: selecting a subagent under
  // another session loads that snapshot afterwards, and a truncated replay may never have carried it.
  const items = createMemo(() => visibleConversationItems(focused()?.children ?? conversation()))
  const pending = createMemo(() => props.snapshot.requests.filter((request) =>
    request.status === 'pending' || request.status === 'resolving'))
  const sessionId = createMemo(() => props.snapshot.session.id)
  // The scroll memory is per view, not per session: the parent's stream and each subagent's run are
  // different lists, so one key would restore the wrong offset every time the reader stepped in or out.
  const viewId = createMemo(() => focused() ? `${sessionId()}:${props.focusSubagentId}` : sessionId())

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
    scrollTopBySession.delete(viewId())
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
    if (following) scrollTopBySession.delete(viewId())
    else scrollTopBySession.set(viewId(), element.scrollTop)
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
  const growth = new ResizeObserver(() => {
    if (target !== null) applyTarget()
    else if (following) pin()
  })
  onCleanup(() => growth.disconnect())
  // Switching sessions or stepping into a subagent swaps the list without remounting, so this covers
  // mount and every change of view. A memo as the dep, not an inline getter: `on()` runs its callback on
  // every notification without comparing the input, and the signal behind the focus prop is one record
  // covering every session, so an inline getter would reset the scroll when another session's row moved.
  createEffect(on(viewId, (id) => {
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
      <Show when={focusedSubagent()}>
        {(subagent) => (
          <div class="agent-subagent-crumb">
            <Button variant="bare" size="sm" onClick={props.onExitSubagent}>← {props.snapshot.session.title}</Button>
            <span><strong>{subagent().title ?? 'Subagent'}</strong><small>{subagentSummary(subagent())}</small></span>
          </div>
        )}
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
              {focusedSubagent() ? 'This subagent has not reported anything yet.' : 'This session is ready for its first turn.'}
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
                  sessionId={sessionId()}
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
