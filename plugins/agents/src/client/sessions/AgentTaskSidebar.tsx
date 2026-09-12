import { agentTelemetry, startAgentView } from './agentTelemetry'
import { createMemo, createEffect, onCleanup, Show } from 'solid-js'
import type { Task } from '@acorn/plugin-api/client'
import {
  EmptyState, Icon, Inline, Menu, Row, RowActions, Rows, Section, SectionHeader, Stack, Text,
} from '@acorn/plugin-api/ui'
import { managedAgentStore } from './managedStore'
import type { AgentPaneModel } from './agentPaneModel'
import { sessionModelLabel } from '../settings/agentConfigOptions'
import ProviderGlyph, { providerMarkName } from './ProviderGlyph'
import RuntimeStateIcon, { SubagentStateIcon } from './RuntimeStateIcon'
import { attentionMark } from './stateTone'
import { subagentSummary } from './subagentDisplay'
import { canStopAgent } from './agentActivity'
import { delegationSummary } from './sessionRoster'
import {
  clearManagedSubagent, openManagedSession, selectManagedSession, selectManagedSubagent,
  selectedManagedSubagent,
} from './managedSelection'

// The Agent pane's `list` region: what is running in this task, in two groups.
//
// Each group is a `Rows` collection, so the arrows, Home, End, type-ahead and the selection that
// survives a refetch are the kit's and this file writes no key handling
// (docs/command-palette-and-shortcuts.md § Focus and typing). Subagents are rows of the sessions collection at depth
// one, rather than a nested list, because stepping into a child run is a selection and not an
// expansion.
//
// There is no third group. It merged this task's PTY sessions with its workflow steps, and opening a
// step spawned a terminal on the harness's resume command. The run pane owns a run's steps now
// (plugins/workflows runs/paneContribution.ts), and the terminal drawer owns PTY sessions, so the
// rows had two better homes and one confusing one (docs/workflows.md § What workflows refuses).

/** The list column's header: how many sessions this task has. Its own region, so it stays put while
 *  the list under it scrolls (docs/panes.md § Layout model). */
export function AgentSidebarHeader(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return <SectionHeader count={model.taskSessions().length}>Agents</SectionHeader>
}

export default function AgentTaskSidebar(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  const view = startAgentView('agents.sidebar.open')
  onCleanup(view.dispose)
  void model.sessionsLoaded.then(view.ready, view.fail)

  const managedRequests = createMemo(() => model.taskSessions().flatMap((session) =>
    (managedAgentStore.snapshots()[session.id]?.requests ?? [])
      .filter((request) => request.status === 'pending' || request.status === 'resolving')
      .map((request) => ({ session, request }))))

  const attentionLoaded = new Map<string, number>()
  createEffect(() => {
    for (const session of model.taskSessions()) {
      if (['none', 'unread', 'completed', 'error'].includes(session.attention)) continue
      if (attentionLoaded.get(session.id) === session.lastEventSeq) continue
      attentionLoaded.set(session.id, session.lastEventSeq)
      void managedAgentStore.loadSnapshot(session.id).catch(() => undefined)
    }
  })

  // Sessions and their subagents in one list, because they are one thing to walk with the arrows.
  // The key says which: `<session id>` or `<session id>/<subagent id>`.
  const sessionRows = createMemo(() => agentTelemetry.measure('agents.sidebar.rows', () =>
    model.sessionRoster().map(({ key, label }) => ({ key, label }))))
  createEffect(() => agentTelemetry.observe('agents.sidebar.row_count', sessionRows().length))
  const sessionOf = (key: string) => model.sessionRoster().find((candidate) => candidate.key === key) ?? null
  const selectedRowKey = createMemo(() => {
    const sessionId = model.selectedSessionId()
    if (!sessionId) return null
    const subagentId = selectedManagedSubagent(sessionId)
    return subagentId ? `${sessionId}/${subagentId}` : sessionId
  })
  const openRow = (key: string) => {
    const found = sessionOf(key)
    if (!found) return
    if (found.kind === 'managed') {
      // Picking the session row is how you come back out of a subagent's run.
      clearManagedSubagent(found.session.id)
      openManagedSession(props.task.id, found.session.id)
      return
    }
    // The session first: a sub-row under a session that is not the open one has to bring its parent's
    // transcript up before there is a card to scroll to.
    if (found.session.id !== model.selectedSessionId()) openManagedSession(props.task.id, found.session.id)
    else selectManagedSession(props.task.id, found.session.id)
    selectManagedSubagent(found.session.id, found.subagent.id)
  }

  return (
    <Stack gap="none">
      <Show when={managedRequests().length}>
        <Section label="Needs you" count={managedRequests().length}>
          <Rows
            id={`agents:requests:${props.task.id}`}
            ariaLabel="Agent requests"
            items={managedRequests().map(({ session, request }) => ({
              key: `${session.id}:${request.providerRequestId}`,
              label: request.title,
            }))}
            onActivate={(key) => {
              const entry = managedRequests()
                .find(({ session, request }) => `${session.id}:${request.providerRequestId}` === key)
              if (entry) openManagedSession(props.task.id, entry.session.id, entry.request.providerRequestId)
            }}
          >
            {(item, itemProps) => {
              const entry = () => managedRequests()
                .find(({ session, request }) => `${session.id}:${request.providerRequestId}` === item.key)
              return (
                <Row
                  item={itemProps}
                  variant="stacked"
                  density="compact"
                  leading={<RuntimeStateIcon state="waiting" />}
                  trailing={
                    <Show when={entry()?.request.kind}>
                      {(kind) => <Icon {...attentionMark(kind())} />}
                    </Show>
                  }
                  onPress={() => {
                    const found = entry()
                    if (found) openManagedSession(props.task.id, found.session.id, found.request.providerRequestId)
                  }}
                >
                  <Text emphasis="strong">{item.label}</Text>
                  <Text emphasis="muted">{entry()?.session.title}</Text>
                </Row>
              )
            }}
          </Rows>
        </Section>
      </Show>

      <Section label="Managed sessions">
        <Show
          when={sessionRows().length}
          fallback={<EmptyState size="sm" align="start">No managed sessions</EmptyState>}
        >
          <Rows
            id={`agents:sessions:${props.task.id}`}
            ariaLabel="Managed sessions"
            items={sessionRows()}
            selected={selectedRowKey()}
            onSelect={openRow}
            onActivate={openRow}
          >
            {(item, itemProps, selected) => {
              const found = () => sessionOf(item.key)
              const session = () => found()?.session
              const subagent = () => {
                const entry = found()
                return entry?.kind === 'provider-subagent' ? entry.subagent : undefined
              }
              const managedRow = () => {
                const entry = found()
                return entry?.kind === 'managed' ? entry : undefined
              }
              return (
                <Show when={session()}>
                  {(current) => (
                    <Show
                      when={subagent()}
                      fallback={
                        <Row
                          item={itemProps}
                          variant="stacked"
                          density="compact"
                          depth={found()?.depth}
                          nested={(found()?.depth ?? 0) > 0}
                          selected={selected()}
                          leading={<RuntimeStateIcon state={current().runtimeState} queued={current().queuedTurns} />}
                          trailing={
                            <>
                              <Show when={!['none', 'unread'].includes(current().attention)}>
                                <Icon {...attentionMark(current().attention)} />
                              </Show>
                              <RowActions ariaLabel="Session actions">
                                {(menu) => (
                                  <>
                                    <Show when={canStopAgent(current())}>
                                      <Menu.Item context={menu} onSelect={() => model.sessionAction(current(), 'stop')}>
                                        Stop
                                      </Menu.Item>
                                    </Show>
                                    <Menu.Item context={menu} onSelect={() => model.sessionAction(current(), 'rename')}>
                                      Rename session
                                    </Menu.Item>
                                    <Menu.Item context={menu} onSelect={() => model.sessionAction(current(), 'archive')}>
                                      Archive session…
                                    </Menu.Item>
                                  </>
                                )}
                              </RowActions>
                            </>
                          }
                          onPress={() => openRow(item.key)}
                        >
                          <Text emphasis="strong">{current().title}</Text>
                          <Inline gap="inline">
                            {/* A session a workflow started, said once on the row. Its steps live in
                                the run pane; this is only how you tell the two kinds apart here. */}
                            <Show when={current().kind === 'workflow'}>
                              <Icon name="workflow" tone="muted" title="Started by a workflow" />
                            </Show>
                            <Show when={providerMarkName(current().providerId)}>
                              {(mark) => <ProviderGlyph glyph={mark()} label={current().providerId} />}
                            </Show>
                            <Text emphasis="muted">
                              {[current().providerId, sessionModelLabel(current()), current().runtimeState]
                                .filter(Boolean).join(' · ')}
                            </Text>
                          </Inline>
                          <Show when={managedRow()}>
                            {(row) => (
                              <Show when={delegationSummary(row())}>
                                {(summary) => <Text emphasis="muted">{summary()}</Text>}
                              </Show>
                            )}
                          </Show>
                        </Row>
                      }
                    >
                      {(child) => (
                        // The subagent roster, indented under the session that spawned it. Read straight
                        // off the session row, which the WebSocket pushes after every event this node
                        // records, so these rows appear and settle live for every session in the task and
                        // not only the one that happens to be open. Nothing extra is fetched
                        // (docs/managed-agents.md § Subagents).
                        <Row
                          item={itemProps}
                          variant="stacked"
                          density="compact"
                          depth={found()?.depth ?? 1}
                          nested
                          selected={selected()}
                          leading={<SubagentStateIcon status={child().status} />}
                          onPress={() => openRow(item.key)}
                        >
                          <Text emphasis="strong">{child().title}</Text>
                          <Text emphasis="muted">{subagentSummary(child(), sessionModelLabel(current()))}</Text>
                        </Row>
                      )}
                    </Show>
                  )}
                </Show>
              )
            }}
          </Rows>
        </Show>
      </Section>
    </Stack>
  )
}
