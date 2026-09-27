import { agentTelemetry, claimAgentSelection } from './agentTelemetry'
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { Alert, EmptyState, IconButton, Only, Text, type TimelineControls } from '@acorn/plugin-api/ui'
import { wsOnReconnect } from '@acorn/plugin-api/client'
import AgentTranscript from './AgentTranscript'
import AgentComposer from '../composer/AgentComposer'
import QueuedAgentTurns from '../composer/QueuedAgentTurns'
import ManagedChildRows from './ManagedChildRows'
import { agentSessionIsStarting } from '../composer/agentComposerState'
import { latestAutomaticTaskContext } from '../composer/automaticTaskContext'
import { managedAgentStore } from './managedStore'
import { clearFocusedManagedRequest, clearManagedSubagent, focusedManagedRequest, selectedManagedSubagent } from './managedSelection'
import type { AgentConversationProps } from '../../contract/conversation'
import TerminalConversationShortcuts from './TerminalConversationShortcuts'

// One session's conversation: its transcript, its queue, and the box you answer it in.
//
// A fragment, not a box. The children have to be direct children of the region that mounts them,
// because the followed timeline is the scroller and `.layout-region-detail` is the flex column it
// sizes against, and two CSS rules name `.ui-timeline-scroll` as a direct child of that region
// (client-core infra/styles/shell.css). Wrapping any of this in a `Stack` puts the pane's header and
// composer inside the scroll and clips the rest, `grow` or not.
//
// Addressed by session id and nothing else, so a surface that has one can draw it: the Agent pane
// (./AgentPane.tsx) and the Workflows run pane, through the capability in
// ../../contract/conversation.ts. Everything it used to take from the Agent pane's model is a read of
// the store or a pure function of the snapshot, so the two surfaces cannot disagree about a session.

export default function AgentConversation(props: AgentConversationProps & {
  /** Take the caret when a session opens. The Agent pane's, not every caller's: the focus request is
   *  one-shot (./managedSelection.ts), so two visible composers would race for it and win by
   *  whichever effect happened to run first. */
  autoFocus?: boolean
}) {
  // The transcript, its effects and its local controls belong to one session. Keep that owner keyed
  // when a pane stays mounted and changes selection; otherwise Solid reuses the old conversation's
  // reactive subtree while its snapshot and cleanup effects are changing underneath it.
  const sessionId = createMemo(() => props.sessionId
    ?? (props.workflowStepId
      ? managedAgentStore.sessions().find((item) => item.config.workflowStepId === props.workflowStepId)?.id
      : undefined)
    ?? '')
  return (
    <Show when={sessionId()} keyed fallback={<EmptyState size="sm">{props.noSession ?? 'No session to show.'}</EmptyState>}>
      {(id) => <SessionConversation sessionId={id} conversation={props} />}
    </Show>
  )
}

function SessionConversation(input: {
  sessionId: string
  conversation: AgentConversationProps & { autoFocus?: boolean }
}) {
  const props = input.conversation
  const sessionId = () => input.sessionId
  const [error, setError] = createSignal('')
  // The transcript actions reach into a sibling: scroll jumps come up from the kit Timeline through
  // `onControls`, while the filter and collapse-all push down as a signal and a counter. The desktop
  // draws buttons above the composer; the terminal registers shortcuts for the same actions.
  const [scrollControls, setScrollControls] = createSignal<TimelineControls>()
  const [chatsOnly, setChatsOnly] = createSignal(false)
  const [collapseTick, setCollapseTick] = createSignal(0)
  const snapshot = createMemo(() => managedAgentStore.snapshots()[sessionId()])
  const stored = createMemo(() => managedAgentStore.sessions().find((item) => item.id === sessionId()))
  // The store's row where there is one, the snapshot's where the roster has not caught up. Both are the
  // same row; `loadSnapshot` upserts what it fetched.
  const session = createMemo(() => stored() ?? snapshot()?.session)
  const previousAutomaticContext = createMemo(() => latestAutomaticTaskContext(snapshot()?.turns ?? []))

  // The selection write above tells us whether switching sessions blocked the current JavaScript
  // turn. This second opt-in point starts when the chosen snapshot becomes renderable and adds only
  // counts already held by the store; it never walks the transcript DOM or copies its content.
  let measuredSnapshot = ''
  createEffect(on(snapshot, (next) => {
    if (!next || next.session.id === measuredSnapshot) return
    measuredSnapshot = next.session.id
    agentTelemetry.startRenderTransition('agents.snapshot.show', {
      'snapshot.events': next.events.length,
      'snapshot.turns': next.turns.length,
      'snapshot.requests': next.requests.length,
    })
  }))

  const releaseSocket = managedAgentStore.activate()
  onCleanup(releaseSocket)

  createEffect(on(sessionId, (id) => {
    setError('')
    if (!id) return
    // Held while drawn, so the store's bound cannot drop the transcript from under the reader.
    onCleanup(managedAgentStore.hold(id))
    const view = claimAgentSelection(id)
    onCleanup(view.dispose)
    // Every mount reads, a return to a session the store already holds included. That read resumes
    // where the held events end, so it brings the turns, the requests and whatever the socket missed,
    // not the transcript again (./managedStore.ts § loadSnapshot).
    void managedAgentStore.loadSnapshot(id).then(() => view.ready()).catch((caught: unknown) => {
      view.fail()
      if (sessionId() !== id) return
      setError(caught instanceof Error ? caught.message : 'Unable to load the agent transcript.')
    })
    // A dropped socket loses frames and nothing replays them, so the session on screen reads on from
    // its mark when the socket comes back. One that is not on screen does the same when it next mounts.
    onCleanup(wsOnReconnect(() => void managedAgentStore.loadSnapshot(id).catch(() => undefined)))
  }))

  const reload = (): void => void managedAgentStore.loadSnapshot(sessionId())
    .catch(() => undefined)

  // The request to reveal is a one-shot navigation command, like the composer focus. A notice or a
  // dashboard row that opened this pane named a request to scroll the reader to; read it once, hand it
  // to the transcript, and clear it from the store. Kept there it would replay the scroll-and-focus
  // every time this session was reopened, pulling a typing reader back to an old request. The latch is
  // dropped when the shown session changes so a stale reveal cannot cross into another session.
  const [focusRequest, setFocusRequest] = createSignal<string>()
  let focusFor = ''
  createEffect(() => {
    const id = sessionId()
    if (id !== focusFor) { focusFor = id; setFocusRequest(undefined) }
    const requested = focusedManagedRequest(id)
    if (!requested) return
    setFocusRequest(requested)
    clearFocusedManagedRequest(id)
  })

  return (
    <Show when={sessionId()} fallback={<EmptyState size="sm">{props.noSession ?? 'No session to show.'}</EmptyState>}>
      <Only hosts={['tui']}>
        <TerminalConversationShortcuts
          top={() => scrollControls()?.toTop()}
          bottom={() => scrollControls()?.toBottom()}
          toggleChats={() => setChatsOnly((on) => !on)}
          collapseTools={() => setCollapseTick((tick) => tick + 1)}
        />
      </Only>
      <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show
        when={snapshot()}
        fallback={(
          <EmptyState busy>
            {session() && agentSessionIsStarting(session()!) ? 'Connecting…' : 'Loading conversation…'}
          </EmptyState>
        )}
      >
        {(narrowed) => (
          <>
            <AgentTranscript
              taskId={narrowed().session.taskId}
              snapshot={narrowed()}
              focusRequestId={focusRequest()}
              focusSubagentId={selectedManagedSubagent(sessionId())}
              viewKeyPrefix={props.viewKeyPrefix}
              chatsOnly={chatsOnly()}
              collapseSignal={collapseTick}
              onControls={setScrollControls}
              onExitSubagent={() => clearManagedSubagent(sessionId())}
              onRequestResolved={reload}
              onPlanImplemented={reload}
            />
            <QueuedAgentTurns
              sessionId={sessionId()}
              runtimeState={narrowed().session.runtimeState}
              turns={narrowed().turns}
              onChanged={reload}
              onError={setError}
            />
          </>
        )}
      </Show>
      {/* Gone while a subagent's run owns the window. The composer only ever addresses the session, so
          leaving it under a subagent's transcript would read as "reply to this subagent", which is not
          a thing either harness offers. The draft survives: it lives in a module map keyed by session
          (../composer/composerState.ts, ./managedDrafts.ts) plus localStorage, not in the component, so
          stepping into a subagent and back leaves half-typed text alone. */}
      <Show when={!selectedManagedSubagent(sessionId()) ? session() : undefined}>
        {(current) => (
          <>
            <Show when={props.note}>{(line) => <Text emphasis="muted" wrap>{line()}</Text>}</Show>
            <ManagedChildRows parentSessionId={current().id} parentTaskId={current().taskId} />
            <AgentComposer
              session={current()}
              disabled={props.composerDisabled || current().controller !== 'acorn'
                || current().runtimeState === 'archived'}
              submitDisabled={agentSessionIsStarting(current())}
              autoFocus={props.autoFocus}
              previousAutomaticContext={previousAutomaticContext()}
              // The transcript view controls, on the composer's own top row so they line up with the
              // model and effort selects. They act on the sibling transcript; the composer only hosts them.
              viewControls={(
                <Only hosts={['dom']}>
                  <IconButton
                    icon="arrow-up-to-line"
                    label="Scroll to the top of the transcript"
                    tip="Go to top"
                    onPress={() => scrollControls()?.toTop()}
                  />
                  <IconButton
                    icon="arrow-down-to-line"
                    label="Scroll to the bottom of the transcript"
                    tip="Go to bottom"
                    onPress={() => scrollControls()?.toBottom()}
                  />
                  <IconButton
                    icon="messages-square"
                    label="Show only agent and user messages"
                    tip="Chats only"
                    pressed={chatsOnly()}
                    onPress={() => setChatsOnly((on) => !on)}
                  />
                  <IconButton
                    icon="fold-vertical"
                    label="Collapse every tool card"
                    tip="Collapse all"
                    onPress={() => setCollapseTick((tick) => tick + 1)}
                  />
                </Only>
              )}
              onSessionUpdated={managedAgentStore.upsertSession}
              onSent={reload}
            />
          </>
        )}
      </Show>
    </Show>
  )
}
