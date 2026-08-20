import { createEffect, createMemo, createResource, For, onCleanup, onMount, Show } from 'solid-js'
import { capabilities, clientCapability, refreshSessions, requestTerminalFocus, sessions, setTerminalOpen, type Task, wsOnStatus } from '@acorn/plugin-api/client'
import { Badge, Button, Row } from '@acorn/plugin-api/ui'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import { terminalSessions } from '@acorn/plugin-terminal/contract/sessionsClient.ts'
import { buildRoster, resumeCommandFor, type RosterRow } from './model'
import { managedAgentStore } from './managedStore'
import { WORKFLOW_CONTROL } from '../contract/workflowControl'
import './agent-task-sidebar.css'

const RUNTIME_GLYPH: Record<string, string> = {
  creating: '◔',
  connecting: '◔',
  replaying: '◔',
  ready: '○',
  working: '●',
  waiting: '‼',
  cancelling: '◐',
  reconnecting: '◐',
  stopped: '■',
  failed: '×',
  archived: '□',
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
  onSelectSession: (sessionId: string, requestId?: string) => void
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
                  leading={<span class="agent-task-state" data-state="waiting">‼</span>}
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
          <For each={props.managedSessions} fallback={<p class="muted agent-task-sidebar-empty">No managed sessions in this task.</p>}>
            {(session) => (
              <Row
                density="compact"
                class="agent-task-row managed-agent-session-row"
                selected={session.id === props.selectedSessionId}
                leading={
                  <span class="agent-task-state" data-state={session.runtimeState}>
                    {RUNTIME_GLYPH[session.runtimeState] ?? '·'}
                  </span>
                }
                trailing={
                  !['none', 'unread'].includes(session.attention)
                    ? <Badge tone={session.attention === 'error' ? 'del' : 'warn'} size="xs">
                        {session.attention.replace('_', ' ')}
                      </Badge>
                    : undefined
                }
                onActivate={() => props.onSelectSession(session.id)}
              >
                <strong>{session.title}</strong>
                <small>{session.providerId} · {session.runtimeState}</small>
              </Row>
            )}
          </For>
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
