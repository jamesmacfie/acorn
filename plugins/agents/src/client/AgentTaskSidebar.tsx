import { createEffect, createMemo, createResource, For, Index, onCleanup, onMount, Show } from 'solid-js'
import { capabilities, clientCapability, refreshSessions, requestTerminalFocus, sessions, setTerminalOpen, type Task, wsOnStatus } from '@acorn/plugin-api/client'
import { Badge, Button, Icon, Menu, Row, StatusDot } from '@acorn/plugin-api/ui'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import { terminalSessions } from '@acorn/plugin-terminal/contract/sessionsClient.ts'
import { buildRoster, resumeCommandFor, type RosterRow } from './model'
import { managedAgentStore } from './managedStore'
import { sessionModelLabel } from './agentConfigOptions'
import ProviderGlyph, { providerMarkName } from './ProviderGlyph'
import { runtimeIcon, runtimeTone, subagentTone } from './stateTone'
import { subagentSummary } from './subagentDisplay'
import { canStopAgent } from './agentActivity'
import { WORKFLOW_CONTROL } from '../contract/workflowControl'
import './agent-task-sidebar.css'

function RuntimeIcon(props: { state: string }) {
  return (
    <span class="agent-task-state" data-state={props.state} data-tone={runtimeTone(props.state)}>
      <Icon name={runtimeIcon(props.state)} />
    </span>
  )
}

const LEGACY_GLYPH: Record<string, string> = {
  starting: '◔',
  working: '●',
  waiting: '◐',
  idle: '○',
  blocked: '‼',
  permission: '‼',
  done: '✓',
  unknown: '·',
}

export default function AgentTaskSidebar(props: {
  task: Task
  managedSessions: AgentSession[]
  selectedSessionId?: string
  selectedSubagentId?: string
  onSelectSession: (sessionId: string, requestId?: string) => void
  onSelectSubagent: (sessionId: string, subagentId: string) => void
  /** The row menu hands the action back up: AgentPane owns the confirm and rename dialogs, and the
   *  selection bookkeeping archiving a session needs. */
  onSessionAction: (session: AgentSession, action: 'rename' | 'archive' | 'stop') => void
  onError: (message: string) => void
}) {
  // The desktop probe, on the capability rather than on a PTY accessor's null return. CommandPalette
  // already reads it this way.
  const hasEngine = () => capabilities().terminal
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
  const managedRequests = createMemo(() => props.managedSessions.flatMap((session) =>
    (managedAgentStore.snapshots()[session.id]?.requests ?? [])
      .filter((request) => request.status === 'pending' || request.status === 'resolving')
      .map((request) => ({ session, request }))))
  const legacy = createMemo(() =>
    buildRoster(props.task.id, sessions(), workflowData().steps, workflowData().runs))

  onMount(() => {
    // `terminalApi().onStatus` was `wsOnStatus`, forwarded verbatim: the session-status frame is
    // client-core's WebSocket, not anything terminal owns.
    const offStatus = wsOnStatus(() => void refetch())
    onCleanup(offStatus)
  })

  const attentionLoaded = new Map<string, number>()
  createEffect(() => {
    for (const session of props.managedSessions) {
      if (['none', 'unread', 'completed', 'error'].includes(session.attention)) continue
      if (attentionLoaded.get(session.id) === session.lastEventSeq) continue
      attentionLoaded.set(session.id, session.lastEventSeq)
      void managedAgentStore.loadSnapshot(session.id).catch(() => undefined)
    }
  })

  async function openLegacy(row: RosterRow) {
    if (!hasEngine()) return
    if (row.kind === 'session') {
      setTerminalOpen(props.task.id, true)
      requestTerminalFocus(props.task.id, row.session.id)
      return
    }
    const resume = resumeCommandFor(row.step)
    if (!resume) {
      props.onError('This workflow step has no resumable provider session.')
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
      props.onError(caught instanceof Error ? caught.message : 'Unable to open the session in a terminal.')
    }
  }

  async function resolveGate(row: Extract<RosterRow, { kind: 'step' }>, approved: boolean) {
    try {
      const workflows = clientCapability(WORKFLOW_CONTROL)
      if (!workflows) throw new Error('The workflows plugin is not available on this node.')
      await workflows.gate(row.step.runId, row.step.id, approved)
      await refetch()
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Unable to resolve the workflow gate.')
    }
  }

  // Contents only: ListDetail draws the <aside> and names the landmark, so returning one here would
  // nest two complementary landmarks and leave the layout on the outer of the pair.
  return (
    <>
      <header class="agent-task-sidebar-head">
        <strong>Agents</strong>
        <span>{props.managedSessions.length}</span>
      </header>
      <div class="scroll">
        <Show when={managedRequests().length}>
          <section class="agent-task-sidebar-section">
            <div class="agent-task-sidebar-label">Needs you</div>
            <For each={managedRequests()}>
              {({ session, request }) => (
                <Row
                  density="compact"
                  class="agent-task-row"
                  leading={<RuntimeIcon state="waiting" />}
                  trailing={<Badge tone="warn" size="xs">{request.kind.replace('_', ' ')}</Badge>}
                  onActivate={() => props.onSelectSession(session.id, request.providerRequestId)}
                >
                  <strong>{request.title}</strong>
                  <small>{session.title}</small>
                </Row>
              )}
            </For>
          </section>
        </Show>

        <section class="agent-task-sidebar-section">
          <div class="agent-task-sidebar-label">Managed sessions</div>
          {/*
            `Index`, not `For`. The store replaces a session's object on every event it receives, so
            reference keying remounted the row, and now its subagent rows, several times a second
            during a fan-out. Position keying keeps the DOM and updates the text in place.
          */}
          <Show when={props.managedSessions.length} fallback={<p class="muted agent-task-sidebar-empty">No managed sessions in this task.</p>}>
            <Index each={props.managedSessions}>
              {(session) => (
                <>
                  <Row
                    density="compact"
                    class="agent-task-row managed-agent-session-row"
                    selected={session().id === props.selectedSessionId}
                    leading={<RuntimeIcon state={session().runtimeState} />}
                    trailing={
                      <>
                        <Show when={!['none', 'unread'].includes(session().attention)}>
                          <Badge tone={session().attention === 'error' ? 'del' : 'warn'} size="xs">
                            {session().attention.replace('_', ' ')}
                          </Badge>
                        </Show>
                        <Menu
                          ariaLabel="Session actions"
                          placement="bottom-end"
                          trigger={({ toggle, open }) => (
                            <Button
                              variant="bare"
                              size="sm"
                              iconOnly
                              class="agent-task-row-menu"
                              aria-label="Session actions"
                              aria-haspopup="menu"
                              aria-expanded={open()}
                              // The row itself is a button; without this, opening the menu also
                              // selects the row underneath it.
                              onClick={(event) => {
                                event.stopPropagation()
                                toggle()
                              }}
                            >
                              <Icon name="ellipsis" />
                            </Button>
                          )}
                        >
                          {(menu) => (
                            <>
                              <Show when={canStopAgent(session())}>
                                <Menu.Item context={menu} onSelect={() => props.onSessionAction(session(), 'stop')}>
                                  Stop
                                </Menu.Item>
                              </Show>
                              <Menu.Item context={menu} onSelect={() => props.onSessionAction(session(), 'rename')}>
                                Rename session
                              </Menu.Item>
                              <Menu.Item context={menu} onSelect={() => props.onSessionAction(session(), 'archive')}>
                                Archive session…
                              </Menu.Item>
                            </>
                          )}
                        </Menu>
                      </>
                    }
                    onActivate={() => props.onSelectSession(session().id)}
                  >
                    <strong>{session().title}</strong>
                    <small>
                      <Show when={providerMarkName(session().providerId)}>
                        {(mark) => <ProviderGlyph glyph={mark()} label={session().providerId} />}
                      </Show>
                      {[session().providerId, sessionModelLabel(session()), session().runtimeState].filter(Boolean).join(' · ')}
                    </small>
                  </Row>
                  {/*
                    The subagent roster, indented under the session that spawned it. Read straight off
                    the session row, which the WebSocket pushes after every event this node records, so
                    these rows appear and settle live for every session in the task and not only the one
                    that happens to be open. Nothing extra is fetched (docs/managed-agents.md §
                    Subagents).
                  */}
                  <Index each={session().subagents}>
                    {(subagent) => (
                      <Row
                        density="compact"
                        class="agent-task-row agent-task-subagent-row"
                        selected={session().id === props.selectedSessionId && subagent().id === props.selectedSubagentId}
                        leading={<StatusDot tone={subagentTone(subagent().status)} />}
                        onActivate={() => props.onSelectSubagent(session().id, subagent().id)}
                      >
                        <strong>{subagent().title}</strong>
                        <small>{subagentSummary(subagent())}</small>
                      </Row>
                    )}
                  </Index>
                </>
              )}
            </Index>
          </Show>
        </section>

        <Show when={legacy().length}>
          <section class="agent-task-sidebar-section">
            <div class="agent-task-sidebar-label">Terminals & workflows</div>
            <For each={legacy()}>
              {(row) => (
                <div class="agent-task-legacy-row">
                  <Row
                    density="compact"
                    class="agent-task-row"
                    leading={<span class="agent-task-state" data-state={row.state}>{LEGACY_GLYPH[row.state] ?? '·'}</span>}
                    onActivate={() => void openLegacy(row)}
                  >
                    <strong>{row.title}</strong>
                    <small>{row.kind === 'step' ? row.step.status : row.state}</small>
                  </Row>
                  <Show when={row.kind === 'step' && row.gate}>
                    <div class="agent-task-gate-actions">
                      <Button size="sm" onClick={() => void resolveGate(row as Extract<RosterRow, { kind: 'step' }>, true)}>
                        Approve
                      </Button>
                      <Button size="sm" tone="danger" onClick={() => void resolveGate(row as Extract<RosterRow, { kind: 'step' }>, false)}>
                        Reject
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </section>
        </Show>
      </div>
    </>
  )
}
