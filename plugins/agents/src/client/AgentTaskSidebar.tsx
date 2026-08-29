import { createMemo, createResource, createEffect, onCleanup, onMount, Show } from 'solid-js'
import {
  clientCapability, hasHostCapability, refreshSessions, requestTerminalFocus, sessions,
  setTerminalOpen, type Task, wsOnStatus,
} from '@acorn/plugin-api/client'
import {
  Badge, Button, Icon, Inline, Menu, Row, RowActions, Rows, Section, SectionHeader, Stack, Text,
} from '@acorn/plugin-api/ui'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import { terminalSessions } from '@acorn/plugin-terminal/contract/sessionsClient.ts'
import { buildRoster, resumeCommandFor, type RosterRow } from './model'
import { managedAgentStore } from './managedStore'
import { agentPaneModel } from './agentPaneModel'
import { sessionModelLabel } from './agentConfigOptions'
import ProviderGlyph, { providerMarkName } from './ProviderGlyph'
import RuntimeStateIcon, { SubagentStateIcon } from './RuntimeStateIcon'
import { subagentSummary } from './subagentDisplay'
import { canStopAgent } from './agentActivity'
import {
  clearManagedSubagent, openManagedSession, selectManagedSession, selectManagedSubagent,
  selectedManagedSubagent,
} from './managedSelection'
import { WORKFLOW_CONTROL } from '../contract/workflowControl'

// The Agent pane's `list` region: what is running in this task, in three groups.
//
// Each group is a `Rows` collection, so the arrows, Home, End, type-ahead and the selection that
// survives a refetch are the kit's and this file writes no key handling
// (docs/future/layout/07-focus-and-keys.md). Subagents are rows of the sessions collection at depth
// one, rather than a nested list, because stepping into a child run is a selection and not an
// expansion.

const LEGACY_ICON: Record<string, string> = {
  starting: 'clock',
  working: 'loader-circle',
  waiting: 'circle-alert',
  idle: 'circle',
  blocked: 'octagon-alert',
  permission: 'octagon-alert',
  done: 'circle-check',
  unknown: 'circle-dashed',
}
const LEGACY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = {
  starting: 'ok',
  working: 'ok',
  waiting: 'warn',
  blocked: 'warn',
  permission: 'warn',
  failed: 'danger',
}

/** The list column's header: how many sessions this task has. Its own region, so it stays put while
 *  the list under it scrolls (docs/panes.md § Layout model). */
export function AgentSidebarHeader(props: { task: Task }) {
  const model = agentPaneModel(props.task)
  return <SectionHeader count={model.taskSessions().length}>Agents</SectionHeader>
}

export default function AgentTaskSidebar(props: { task: Task }) {
  const model = agentPaneModel(props.task)
  // The desktop probe, on the capability rather than on a PTY accessor's null return. CommandPalette
  // already reads it this way.
  const hasEngine = () => hasHostCapability({ plugin: 'terminal' })
  const [workflowData, { refetch }] = createResource(
    () => props.task.id,
    async (taskId) => {
      // Resolved per call, never captured: client plugin registration order isn't a dependency
      // contract, and `undefined` here is also the honest answer on a node with workflows disabled, so
      // the roster shows agent sessions alone rather than failing to render.
      const workflows = clientCapability(WORKFLOW_CONTROL)
      if (!hasEngine() || !workflows) return { runs: [], steps: [] as WorkflowStepRow[] }
      const runs = await workflows.runs(taskId)
      const steps = (await Promise.all(runs.map((run) => workflows.steps(run.id)))).flat()
      return { runs, steps }
    },
    { initialValue: { runs: [], steps: [] } },
  )

  const managedRequests = createMemo(() => model.taskSessions().flatMap((session) =>
    (managedAgentStore.snapshots()[session.id]?.requests ?? [])
      .filter((request) => request.status === 'pending' || request.status === 'resolving')
      .map((request) => ({ session, request }))))
  const legacy = createMemo(() =>
    buildRoster(props.task.id, sessions(), workflowData().steps, workflowData().runs))

  onMount(() => {
    // `terminalApi().onStatus` was `wsOnStatus`, forwarded verbatim: the session-status frame is
    // client-core's WebSocket, not anything terminal owns.
    onCleanup(wsOnStatus(() => void refetch()))
  })

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
  const sessionRows = createMemo(() => model.taskSessions().flatMap((session) => [
    { key: session.id, label: session.title },
    ...session.subagents.map((subagent) => ({ key: `${session.id}/${subagent.id}`, label: subagent.title })),
  ]))
  const sessionOf = (key: string) => {
    const [sessionId, subagentId] = key.split('/')
    const session = model.taskSessions().find((candidate) => candidate.id === sessionId)
    return session ? { session, subagentId } : null
  }
  const selectedRowKey = createMemo(() => {
    const sessionId = model.selectedSessionId()
    if (!sessionId) return null
    const subagentId = selectedManagedSubagent(sessionId)
    return subagentId ? `${sessionId}/${subagentId}` : sessionId
  })
  const openRow = (key: string) => {
    const found = sessionOf(key)
    if (!found) return
    if (!found.subagentId) {
      // Picking the session row is how you come back out of a subagent's run.
      clearManagedSubagent(found.session.id)
      openManagedSession(props.task.id, found.session.id)
      return
    }
    // The session first: a sub-row under a session that is not the open one has to bring its parent's
    // transcript up before there is a card to scroll to.
    if (found.session.id !== model.selectedSessionId()) openManagedSession(props.task.id, found.session.id)
    else selectManagedSession(props.task.id, found.session.id)
    selectManagedSubagent(found.session.id, found.subagentId)
  }

  async function openLegacy(row: RosterRow) {
    if (!hasEngine()) return
    if (row.kind === 'session') {
      setTerminalOpen(props.task.id, true)
      requestTerminalFocus(props.task.id, row.session.id)
      return
    }
    const resume = resumeCommandFor(row.step)
    if (!resume) {
      model.setError('This workflow step has no resumable provider session.')
      return
    }
    try {
      const terminal = await terminalSessions.create({
        taskId: props.task.id,
        profileId: row.step.profileId ?? 'claude-code',
        command: resume,
        title: `⏎ ${row.step.name}`,
      })
      await refreshSessions()
      setTerminalOpen(props.task.id, true)
      requestTerminalFocus(props.task.id, terminal.id)
    } catch (caught) {
      model.setError(caught instanceof Error ? caught.message : 'Unable to open the session in a terminal.')
    }
  }

  async function resolveGate(row: Extract<RosterRow, { kind: 'step' }>, approved: boolean) {
    try {
      const workflows = clientCapability(WORKFLOW_CONTROL)
      if (!workflows) throw new Error('The workflows plugin is not available on this node.')
      await workflows.gate(row.step.runId, row.step.id, approved)
      await refetch()
    } catch (caught) {
      model.setError(caught instanceof Error ? caught.message : 'Unable to resolve the workflow gate.')
    }
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
                  trailing={<Badge tone="warn" size="xs">{entry()?.request.kind.replace('_', ' ')}</Badge>}
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
          fallback={<Text emphasis="muted" wrap>No managed sessions in this task.</Text>}
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
                return entry?.subagentId
                  ? entry.session.subagents.find((candidate) => candidate.id === entry.subagentId)
                  : undefined
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
                          selected={selected()}
                          leading={<RuntimeStateIcon state={current().runtimeState} />}
                          trailing={
                            <>
                              <Show when={!['none', 'unread'].includes(current().attention)}>
                                <Badge tone={current().attention === 'error' ? 'danger' : 'warn'} size="xs">
                                  {current().attention.replace('_', ' ')}
                                </Badge>
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
                            <Show when={providerMarkName(current().providerId)}>
                              {(mark) => <ProviderGlyph glyph={mark()} label={current().providerId} />}
                            </Show>
                            <Text emphasis="muted">
                              {[current().providerId, sessionModelLabel(current()), current().runtimeState]
                                .filter(Boolean).join(' · ')}
                            </Text>
                          </Inline>
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
                          depth={1}
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

      <Show when={legacy().length}>
        <Section label="Terminals and workflows">
          <Rows
            id={`agents:legacy:${props.task.id}`}
            ariaLabel="Terminals and workflows"
            items={legacy().map((row) => ({ key: row.id, label: row.title }))}
            onActivate={(key) => {
              const row = legacy().find((candidate) => candidate.id === key)
              if (row) void openLegacy(row)
            }}
          >
            {(item, itemProps) => {
              const row = () => legacy().find((candidate) => candidate.id === item.key)
              return (
                <Show when={row()}>
                  {(current) => (
                    <Row
                      item={itemProps}
                      variant="stacked"
                      density="compact"
                      leading={
                        <Icon
                          name={LEGACY_ICON[current().state] ?? 'circle-dashed'}
                          tone={LEGACY_TONE[current().state] ?? 'muted'}
                          spin={current().state === 'working'}
                        />
                      }
                      trailing={
                        <Show when={current().kind === 'step' && (current() as Extract<RosterRow, { kind: 'step' }>).gate}>
                          <Inline>
                            <Button
                              size="sm"
                              onPress={() => void resolveGate(current() as Extract<RosterRow, { kind: 'step' }>, true)}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              tone="danger"
                              onPress={() => void resolveGate(current() as Extract<RosterRow, { kind: 'step' }>, false)}
                            >
                              Reject
                            </Button>
                          </Inline>
                        </Show>
                      }
                      onPress={() => void openLegacy(current())}
                    >
                      <Text emphasis="strong">{current().title}</Text>
                      <Text emphasis="muted">
                        {current().kind === 'step'
                          ? (current() as Extract<RosterRow, { kind: 'step' }>).step.status
                          : current().state}
                      </Text>
                    </Row>
                  )}
                </Show>
              )
            }}
          </Rows>
        </Section>
      </Show>
    </Stack>
  )
}
