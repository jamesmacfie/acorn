import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { AgentSessionSnapshot } from '../../../core/shared/managedAgents'
import AgentEventCard from './AgentEventCard'
import AgentRequestCard from './AgentRequestCard'
import { buildConversationItems } from './conversationItems'

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
const VIRTUALIZE_AFTER = 150

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
  const measureKey = createMemo(() => {
    const last = items().at(-1)
    return `${items().length}:${last?.lastSeq ?? 0}`
  })
  const virtualizer = createVirtualizer({
    get count() {
      return items().length
    },
    getScrollElement: () => scrollElement() ?? null,
    estimateSize: () => 120,
    overscan: 8,
  })
  let wasNearBottom = true
  let measureFrame = 0
  const publishScrollElement = (element: HTMLDivElement) => {
    setScrollElement(element)
    measureFrame = requestAnimationFrame(() => virtualizer.measure())
  }
  const noteScroll = () => {
    const element = scrollElement()
    if (!element) return
    wasNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }
  const virtualItems = () => virtualizer.getVirtualItems()
  const useVirtualRows = () =>
    items().length > VIRTUALIZE_AFTER && virtualItems().length > 0
  createEffect(on(measureKey, () => {
    cancelAnimationFrame(measureFrame)
    measureFrame = requestAnimationFrame(() => {
      virtualizer.measure()
      if (!wasNearBottom || !items().length) return
      if (useVirtualRows()) virtualizer.scrollToIndex(items().length - 1, { align: 'end' })
      else {
        const element = scrollElement()
        if (element) element.scrollTop = element.scrollHeight
      }
    })
  }, { defer: true }))
  onCleanup(() => cancelAnimationFrame(measureFrame))

  const renderItem = (item: ReturnType<typeof items>[number]) => (
    <AgentEventCard
      item={item}
      taskId={props.taskId}
      turn={props.snapshot.turns.find((turn) => turn.id === item.turnId)}
    />
  )

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
      <div class="agent-transcript" ref={publishScrollElement} onScroll={noteScroll}>
        <Show
          when={items().length}
          fallback={
            <div class="agent-conversation-empty">
              <span class="agent-empty-mark">✦</span>
              <p>This session is ready for its first turn.</p>
            </div>
          }
        >
          <Show
            when={useVirtualRows()}
            fallback={
              <div class="agent-transcript-list">
                <For each={items()}>{renderItem}</For>
              </div>
            }
          >
            <div class="agent-transcript-canvas" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              <For each={virtualItems()}>
                {(virtualItem) => {
                  const item = () => items()[virtualItem.index]
                  return (
                    <div
                      class="agent-virtual-row"
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <Show when={item()}>
                        {(value) => renderItem(value())}
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
