import { claimAgentSelection } from './agentTelemetry'
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { Alert, EmptyState, Text } from '@acorn/plugin-api/ui'
import AgentTranscript from './AgentTranscript'
import AgentComposer from '../composer/AgentComposer'
import QueuedAgentTurns from '../composer/QueuedAgentTurns'
import { agentSessionIsStarting } from '../composer/agentComposerState'
import { latestAutomaticTaskContext } from '../composer/automaticTaskContext'
import { managedAgentStore } from './managedStore'
import { clearManagedSubagent, focusedManagedRequest, selectedManagedSubagent } from './managedSelection'
import type { AgentConversationProps } from '../../contract/conversation'

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
  const [error, setError] = createSignal('')
  // A memo, not an inline getter. `on()` re-runs its callback on every notification without comparing
  // the input, and `loadSnapshot` ends in `upsertSession`, which replaces the row a caller may have
  // derived this id from. That was an infinite reload loop in the pane model this came out of.
  //
  // Falling back to the step's own session is what lets a caller draw a step that is still running.
  // The node writes `config.workflowStepId` when it starts the session
  // (../../server/sessions/sessionExecute.ts) and re-broadcasts the row after every event it records,
  // and this client holds an app-lifetime subscription to that, so the lookup is a scan of a roster
  // that is already in memory.
  const sessionId = createMemo(() => props.sessionId
    ?? (props.workflowStepId
      ? managedAgentStore.sessions().find((item) => item.config.workflowStepId === props.workflowStepId)?.id
      : undefined)
    ?? '')
  const snapshot = createMemo(() => managedAgentStore.snapshots()[sessionId()])
  const stored = createMemo(() => managedAgentStore.sessions().find((item) => item.id === sessionId()))
  // The store's row where there is one, the snapshot's where the roster has not caught up. Both are the
  // same row; `loadSnapshot` upserts what it fetched.
  const session = createMemo(() => stored() ?? snapshot()?.session)
  const previousAutomaticContext = createMemo(() => latestAutomaticTaskContext(snapshot()?.turns ?? []))

  const releaseSocket = managedAgentStore.activate()
  onCleanup(releaseSocket)

  createEffect(on(sessionId, (id) => {
    setError('')
    if (!id) return
    const view = claimAgentSelection(id)
    onCleanup(view.dispose)
    void managedAgentStore.loadSnapshot(id).then(() => view.ready()).catch((caught: unknown) => {
      view.fail()
      if (sessionId() !== id) return
      setError(caught instanceof Error ? caught.message : 'Unable to load the agent transcript.')
    })
  }))

  const reload = (): void => void managedAgentStore.loadSnapshot(sessionId())
    .catch(() => undefined)

  return (
    <Show when={sessionId()} fallback={<EmptyState size="sm">{props.noSession ?? 'No session to show.'}</EmptyState>}>
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
              focusRequestId={focusedManagedRequest(sessionId())}
              focusSubagentId={selectedManagedSubagent(sessionId())}
              viewKeyPrefix={props.viewKeyPrefix}
              onExitSubagent={() => clearManagedSubagent(sessionId())}
              onRequestResolved={reload}
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
            <AgentComposer
              session={current()}
              disabled={props.composerDisabled || current().controller !== 'acorn'
                || current().runtimeState === 'archived'}
              submitDisabled={agentSessionIsStarting(current())}
              autoFocus={props.autoFocus}
              previousAutomaticContext={previousAutomaticContext()}
              onSessionUpdated={managedAgentStore.upsertSession}
              onSent={reload}
            />
          </>
        )}
      </Show>
    </Show>
  )
}
