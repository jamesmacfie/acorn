import { agentTelemetry } from './agentTelemetry'
import { createComputed, createMemo, createSignal, For, onCleanup, Show, untrack, type Setter } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '@acorn/plugin-api/client'
import type { AgentNormalizedEvent, AgentSessionSnapshot } from '../../contract/wire.ts'
import AgentEventCard from './AgentEventCard'
import {
  createConversationProjection, findSubagentItem, isChatItem, visibleConversationItems,
  type AgentConversationItem,
} from './conversationItems'
import { sessionModelSummary } from '../settings/agentConfigOptions'
import { Button, EmptyState, Icon, Inline, Text, Timeline, Toolbar, type TimelineControls } from '@acorn/plugin-api/ui'
import { subagentSummary } from './subagentDisplay'
import { agentSessionIsStarting } from '../composer/agentComposerState'
import { AgentToolFoldContext, createAgentToolFoldSetting } from './toolFoldPrefs'
import { readingPlace, rememberReadingPlace } from './readingPlaceStore'

// The session's stream, as a `Timeline` of cards.
//
// `follow` is the kit's: the scroller, staying on the newest turn until the reader scrolls away from
// it, and the place a reader is returned to when they come back are all the timeline's now
// (client-core/src/kit/components/content/Timeline.tsx). This file used to hold that machinery and a scroll element of
// its own, and none of it was anything but a transcript's ordinary behaviour.
export default function AgentTranscript(props: {
  taskId: string
  snapshot: AgentSessionSnapshot
  focusRequestId?: string
  focusSubagentId?: string
  /** Which surface is drawing this, for the scroll place below. Two panes can be open on one session
   *  and a reader can be following live in one while reading history in the other. */
  viewKeyPrefix?: string
  /** Keep only the reader's and the agent's messages, dropping tool calls, reasoning and notes. Driven
   *  by the "show chats only" toggle above the composer. */
  chatsOnly?: boolean
  /** Bumped by "collapse all" above the composer; every tool card watches it and shuts. */
  collapseSignal?: () => number
  /** Handed the transcript's scroll jumps once the scroller exists, for the top/bottom buttons that
   *  live outside this element above the composer. */
  onControls?: (api: TimelineControls) => void
  onExitSubagent: () => void
  onRequestResolved: () => void
}) {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const foldSetting = createAgentToolFoldSetting(() => prefs.data, queryClient, props.collapseSignal)
  // Kept open across events, so a streamed row costs the fold one record rather than the whole
  // session (createConversationProjection). An item no event touched keeps last time's object, so the
  // rows below can tell which card an event changed.
  const project = createConversationProjection()
  const conversation = createMemo<AgentConversationItem[]>(() => {
    agentTelemetry.observe('agents.transcript.events', props.snapshot.events.length)
    return agentTelemetry.measure('agents.transcript.project', () => project(props.snapshot.events))
  })
  // Every event brings a new snapshot object, but it holds the same `turns` and `requests` arrays: the
  // store replaces one only when a turn or a request changes. Reading each through its own memo means an
  // ordinary event does not rebuild the maps below, or wake every card that reads from them.
  const turns = createMemo(() => props.snapshot.turns)
  const requests = createMemo(() => props.snapshot.requests)
  // One map above the list, not `turns.find` inside it. The row body ran that find once per row per
  // render, so a streamed event cost rows times turns; a long session is thousands of rows and hundreds
  // of turns, twenty-five times a second.
  const turnsById = createMemo(() => new Map(turns().map((turn) => [turn.id, turn])))
  // Same reason, keyed the way the sidebar and every notice name a request. A request's card draws from
  // the row rather than from its own event, because whether anybody has answered yet, and what they
  // said, both live on the row and keep changing long after the event is written.
  const requestsById = createMemo(() =>
    new Map(requests().map((request) => [request.providerRequestId, request])))
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
  const items = createMemo(() => {
    const visible = agentTelemetry.measure('agents.transcript.visible', () =>
      visibleConversationItems(focused()?.children ?? conversation(), (requestId) => requestsById().get(requestId)))
    const shown = props.chatsOnly ? visible.filter(isChatItem) : visible
    agentTelemetry.observe('agents.transcript.items', shown.length)
    return shown
  })
  // The list is rendered by its rows' own keys, not by array position. Two lookups over the same
  // `items()`: the ordered keys `For` diffs, and the item behind each key. `record.id` is a global
  // UUID, so a key is unique across sessions and subagents and never collides when the list swaps.
  const itemKeys = createMemo(() => items().map((item) => item.key))
  const itemsByKey = createMemo(() => new Map(items().map((item) => [item.key, item])))
  const sessionId = createMemo(() => props.snapshot.session.id)
  const sessionModel = createMemo(() => sessionModelSummary(props.snapshot.session))
  // The scroll memory is per view, not per session: the parent's stream and each subagent's run are
  // different lists, so one key would restore the wrong offset every time the reader stepped in or out.
  // Two surfaces on the same stream are two lists in that same sense, so the prefix is part of the key.
  const viewId = createMemo(() => {
    const view = focused() ? `${sessionId()}:${props.focusSubagentId}` : sessionId()
    return props.viewKeyPrefix ? `${props.viewKeyPrefix}:${view}` : view
  })
  // Initial rows are one batch: aggregate their factory time and the wall time to the next
  // microtask, then stay out of the 25 Hz streaming path. This is deliberately a turn-scoped probe,
  // not one record per card.
  let measuringInitialCards = true
  queueMicrotask(() => { measuringInitialCards = false })
  // Each row reads its item from a signal of its own, written only when its key's item is a different
  // object. A memo per row over `itemsByKey` would do the same, but the map is new on every event, so
  // all the memos would re-run: about 10 ms an event on a 1,240-card transcript, against 0.3 ms for this
  // loop.
  const rows = new Map<string, Setter<AgentConversationItem>>()
  createComputed(() => {
    const byKey = itemsByKey()
    for (const [key, set] of rows) {
      const item = byKey.get(key)
      if (item) set(item)
    }
  })
  const row = (key: string) => {
    const [item, set] = createSignal(untrack(itemsByKey).get(key)!)
    rows.set(key, set)
    onCleanup(() => rows.delete(key))
    return renderCard(item)
  }
  const renderCard = (item: () => AgentConversationItem) => {
    const draw = () => (
      <Timeline.Turn key={item().key}>
        <AgentEventCard
          item={item()}
          taskId={props.taskId}
          sessionId={sessionId()}
          sessionModel={sessionModel()}
          turn={turnsById().get(item().turnId ?? '')}
          request={item().event.type === 'request'
            ? requestsById().get((item().event as Extract<AgentNormalizedEvent, { type: 'request' }>).requestId)
            : undefined}
          focusRequest={item().event.type === 'request'
            && (item().event as Extract<AgentNormalizedEvent, { type: 'request' }>).requestId === props.focusRequestId}
          onRequestResolved={props.onRequestResolved}
        />
      </Timeline.Turn>
    )
    return measuringInitialCards
      ? agentTelemetry.measureRenderBatch('agents.transcript.cards', draw, { 'items.visible': items().length })
      : draw()
  }

  return (
    <>
      <Show when={focusedSubagent()}>
        {(narrowed) => {
          const subagent = narrowed
          return (
          <Toolbar ariaLabel="Subagent run">
            <Button variant="bare" size="sm" onPress={props.onExitSubagent}>
              <Icon name="arrow-left" /> {props.snapshot.session.title}
            </Button>
            <Inline>
              <Text emphasis="strong">{subagent().title ?? 'Subagent'}</Text>
              <Text emphasis="muted">{subagentSummary(subagent(), sessionModel())}</Text>
            </Inline>
          </Toolbar>
          )
        }}
      </Show>
      <Show
        when={items().length}
        fallback={
          <EmptyState
            icon={<Icon name="sparkles" tone="accent" />}
            busy={!focusedSubagent() && agentSessionIsStarting(props.snapshot.session)}
          >
            {focusedSubagent()
              ? 'This subagent has not reported anything yet.'
              : agentSessionIsStarting(props.snapshot.session)
                ? 'Connecting…'
                : 'This session is ready for its first turn.'}
          </EmptyState>
        }
      >
        <Timeline
          follow
          place={() => readingPlace(viewId())}
          onChange={(next) => rememberReadingPlace(viewId(), next)}
          ariaLabel="Agent transcript"
          controls={props.onControls}
        >
          {/*
            `For` over the rows' keys, not `Index` over their positions. An item that changed is a new
            object, so `For` over the objects would remount a card on each streamed event and take any
            in-progress selection with it — which is why this was an `Index`. But `Index` keys by
            position: a filter (chats-only, or a resolved permission leaving the thread) shifts every
            later row onto a new item while its card keeps the previous item's local state, its
            open/closed tool fold. Keyed by the projection's stable id instead, a card's DOM stays tied to
            its own item — the same key reuses the row, an appended key mounts one card, a removed key
            disposes one — while streamed text and status still update through the row's signal.
          */}
          {/* One fold setting for the whole list, read by every tool card below it. See the note on
              createAgentToolFoldSetting for why it is not resolved per card. */}
          <AgentToolFoldContext.Provider value={foldSetting}>
            <For each={itemKeys()}>
              {(key) => row(key)}
            </For>
          </AgentToolFoldContext.Provider>
        </Timeline>
      </Show>
    </>
  )
}
