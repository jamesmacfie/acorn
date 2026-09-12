import { agentTelemetry } from './agentTelemetry'
import { createMemo, Index, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '@acorn/plugin-api/client'
import type { AgentNormalizedEvent, AgentSessionSnapshot } from '@acorn/protocol/managedAgents.ts'
import AgentEventCard from './AgentEventCard'
import { buildConversationItems, findSubagentItem, visibleConversationItems } from './conversationItems'
import { sessionModelLabel } from '../settings/agentConfigOptions'
import { Button, EmptyState, Icon, Inline, Text, Timeline, Toolbar } from '@acorn/plugin-api/ui'
import { subagentSummary } from './subagentDisplay'
import { agentSessionIsStarting } from '../composer/agentComposerState'
import { AgentToolFoldContext, createAgentToolFoldSetting } from './toolFoldPrefs'

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
  onExitSubagent: () => void
  onRequestResolved: () => void
}) {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const foldSetting = createAgentToolFoldSetting(() => prefs.data, queryClient)
  const conversation = createMemo(() => {
    agentTelemetry.observe('agents.transcript.events', props.snapshot.events.length)
    return agentTelemetry.measure('agents.transcript.project', () => buildConversationItems(props.snapshot.events))
  })
  // One map above the list, not `turns.find` inside it. The row body ran that find once per row per
  // render, so a streamed event cost rows times turns; a long session is thousands of rows and hundreds
  // of turns, twenty-five times a second.
  const turnsById = createMemo(() => new Map(props.snapshot.turns.map((turn) => [turn.id, turn])))
  // Same reason, keyed the way the sidebar and every notice name a request. A request's card draws from
  // the row rather than from its own event, because whether anybody has answered yet, and what they
  // said, both live on the row and keep changing long after the event is written.
  const requestsById = createMemo(() =>
    new Map(props.snapshot.requests.map((request) => [request.providerRequestId, request])))
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
    const items = agentTelemetry.measure('agents.transcript.visible', () =>
      visibleConversationItems(focused()?.children ?? conversation(), (requestId) => requestsById().get(requestId)))
    agentTelemetry.observe('agents.transcript.items', items.length)
    return items
  })
  const sessionId = createMemo(() => props.snapshot.session.id)
  const sessionModel = createMemo(() => sessionModelLabel(props.snapshot.session))
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
  const renderCard = (item: () => ReturnType<typeof items>[number]) => {
    const draw = () => (
      <Timeline.Turn>
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
        <Timeline follow viewKey={viewId()} ariaLabel="Agent transcript">
          {/*
            `Index`, not `For`: buildConversationItems rebuilds every item object on every snapshot, and
            `For` keys by reference, so it would recreate the whole list on each streamed event and take
            any in-progress selection with it. Position-keyed rows keep their DOM.
          */}
          {/* One fold setting for the whole list, read by every tool card below it. See the note on
              createAgentToolFoldSetting for why it is not resolved per card. */}
          <AgentToolFoldContext.Provider value={foldSetting}>
            <Index each={items()}>
              {(item) => renderCard(item)}
            </Index>
          </AgentToolFoldContext.Provider>
        </Timeline>
      </Show>
    </>
  )
}
