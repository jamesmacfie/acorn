import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { Task } from '../../queries'
import type { TerminalProfile } from '../../../shared/terminal'
import { refreshSessions, sessions } from '../terminal/sessions'
import { terminalApi, type WorkflowStepRow } from '../terminal/terminalClient'
import { workflowApi } from './workflowClient'
import { setTerminalOpen } from '../tasks/tasks'
import { buildRoster, feedFromEvents, resumeCommandFor, stepFeed, type RosterRow, type StreamEvent } from './model'
import './agents-panel.css'

const STATE_GLYPH: Record<string, string> = {
  starting: '◔',
  working: '●',
  waiting: '◐',
  idle: '○',
  blocked: '‼',
  permission: '‼',
  done: '✓',
  unknown: '·',
}

// The Agents panel (docs/terminal-and-agents.md): ONE right-rail surface = roster (PTY sessions + workflow
// steps) + "+ New agent" launcher + the per-agent view — an activity feed for headless/workflow
// agents (their stream-json has no TUI), a jump-to-terminal for interactive ones, gate prompts
// inline, and "open in terminal" (--resume) for any step with a session id. The raw xterm drawer
// is untouched — this is the managed surface, never a terminal replacement.
export default function AgentsPanel(props: { task: Task; onClose: () => void }) {
  const api = terminalApi()
  const [selected, setSelected] = createSignal<string | null>(null)
  const [launcherOpen, setLauncherOpen] = createSignal(false)
  const [actionError, setActionError] = createSignal('')
  const [liveEvents, setLiveEvents] = createSignal<Record<string, StreamEvent[]>>({})
  const [clock, setClock] = createSignal(Date.now())

  const [workflowData, { refetch }] = createResource(
    () => props.task.id,
    async (taskId) => {
      if (!api) return { runs: [], steps: [] as WorkflowStepRow[] }
      const runs = await workflowApi.runs(taskId)
      const steps = (await Promise.all(runs.map((r) => workflowApi.steps(r.id)))).flat()
      return { runs, steps }
    },
    { initialValue: { runs: [], steps: [] } },
  )
  // Push-driven refresh: status transitions and live stream events share the authenticated WS.
  onMount(() => {
    const off = api?.onStatus(() =>
      void Promise.resolve(refetch()).then(() => {
        // Live buffers only matter while a step is running — drop finished/foreign entries.
        const running = new Set(workflowData().steps.filter((s) => s.status === 'running').map((s) => s.id))
        setLiveEvents((current) => Object.fromEntries(Object.entries(current).filter(([stepId]) => running.has(stepId))))
      }),
    )
    const offEvent = api?.workflow.onStepEvent(({ runId, stepId, event }) => {
      if (!event || typeof event !== 'object') return
      if (!workflowData().runs.some((run) => run.id === runId)) return // other tasks' runs share the WS
      setLiveEvents((current) => ({ ...current, [stepId]: [...(current[stepId] ?? []), event as StreamEvent].slice(-100) }))
    })
    const timer = setInterval(() => setClock(Date.now()), 5000)
    onCleanup(() => {
      off?.()
      offEvent?.()
      clearInterval(timer)
    })
  })

  const roster = () => buildRoster(props.task.id, sessions(), workflowData().steps, workflowData().runs)
  const current = (): RosterRow | undefined => roster().find((r) => r.id === selected()) ?? roster()[0]

  const [profiles] = createResource(async () => (api ? await api.profiles() : []), { initialValue: [] })

  async function launch(profile: TerminalProfile) {
    if (!api) return
    setLauncherOpen(false)
    await api.create({ taskId: props.task.id, profileId: profile.id })
    await refreshSessions()
    setTerminalOpen(props.task.id, true) // interactive agents live in the raw drawer (15 §dual-path)
  }

  // Open-in-terminal (15 P2): resume a step's session as a raw TUI in the drawer.
  async function openInTerminal(row: RosterRow) {
    if (!api) return
    if (row.kind === 'session') {
      setTerminalOpen(props.task.id, true)
      return
    }
    const resume = resumeCommandFor(row.step)
    if (!resume) return setActionError('This step has no resumable session.')
    setActionError('')
    await api.create({ taskId: props.task.id, profileId: row.step.profileId ?? 'claude-code', command: resume, title: `⏎ ${row.step.name}` })
    await refreshSessions()
    setTerminalOpen(props.task.id, true)
  }

  async function resolveGate(row: RosterRow, approved: boolean) {
    if (!api || row.kind !== 'step') return
    await workflowApi.gate(row.step.runId, row.step.id, approved)
    await refetch()
  }

  async function cancelRun(row: Extract<RosterRow, { kind: 'step' }>) {
    if (!row.run) return
    setActionError('')
    try {
      await workflowApi.cancel(row.run.id)
      await refetch()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to cancel workflow.')
    }
  }

  async function killStep(row: Extract<RosterRow, { kind: 'step' }>) {
    setActionError('')
    try {
      await workflowApi.kill(row.step.runId, row.step.id)
      await refetch()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to kill step.')
    }
  }

  return (
    <Portal>
      <aside class="agents-panel">
        <div class="agents-head">
          <span class="agents-title">Agents</span>
          <button type="button" class="overlay-btn" onClick={() => setLauncherOpen(!launcherOpen())}>+ New agent</button>
          <button type="button" class="agents-close" title="Close" onClick={props.onClose}>✕</button>
        </div>
        <Show when={actionError()}><div class="action-error" role="alert">{actionError()}</div></Show>
        <Show when={launcherOpen()}>
          <div class="agents-launcher">
            <For each={profiles() ?? []}>
              {(p) => (
                <button type="button" class="agents-launch-row" disabled={!p.available} onClick={() => void launch(p)}>
                  {p.label}
                  <Show when={!p.available}><span class="muted"> (not on PATH)</span></Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        <ul class="agents-roster">
          <For each={roster()} fallback={<li class="muted agents-empty">No agents yet — launch one, or start a workflow from ⌘K.</li>}>
            {(row) => (
              <li>
                <button type="button" class="agents-row" classList={{ active: current()?.id === row.id, needs: row.state === 'blocked' }} onClick={() => setSelected(row.id)}>
                  <span class="agents-dot" data-state={row.state}>{STATE_GLYPH[row.state] ?? '·'}</span>
                  <span class="agents-row-title">{row.title}</span>
                  <span class="agents-row-state muted">
                    {row.kind === 'step' ? row.step.status : row.state}
                    {row.kind === 'step' && row.step.costUsd != null ? ` $${row.step.costUsd.toFixed(2)}` : ''}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>

        <Show when={current()}>
          {(row) => {
            // Narrow once; every step-only branch below is guarded by a kind === 'step' check.
            const stepRow = () => row() as Extract<RosterRow, { kind: 'step' }>
            return (
              <div class="agents-detail">
                <div class="agents-detail-head">
                  <span class="agents-row-title">{row().title}</span>
                  <div class="agents-gate-actions">
                    <Show when={row().kind === 'step' && stepRow().step.status === 'running'}>
                      <button type="button" class="overlay-btn agents-reject" onClick={() => void killStep(stepRow())}>kill step</button>
                    </Show>
                    <Show when={row().kind === 'step' && ['running', 'gated'].includes(stepRow().run?.status ?? '')}>
                      <button type="button" class="overlay-btn agents-reject" onClick={() => void cancelRun(stepRow())}>cancel run</button>
                    </Show>
                    <button type="button" class="overlay-btn" onClick={() => void openInTerminal(row())}>
                      {row().kind === 'session' ? 'show terminal' : 'open in terminal'}
                    </button>
                  </div>
                </div>
                <Show when={row().kind === 'step' && row().state !== 'unknown'}>
                  <Show
                    when={stepRow().gate}
                    fallback={
                      <ul class="agents-feed">
                        <For
                          each={[
                            ...stepFeed(stepRow().step).items,
                            ...(stepRow().step.status === 'running' ? feedFromEvents(liveEvents()[stepRow().step.id] ?? []) : []),
                          ]}
                          fallback={
                            <li class="muted">
                              No captured activity
                              {stepRow().step.status === 'running'
                                ? clock() - stepRow().step.updatedAt > 30_000
                                  ? ' — no output for 30 seconds.'
                                  : ' yet — running…'
                                : '.'}
                            </li>
                          }
                        >
                          {(item) => (
                            <li class="agents-feed-item" data-kind={item.kind}>
                              <span class="agents-feed-glyph">
                                {item.kind === 'tool_call' ? '▸' : item.kind === 'tool_result' ? '◂' : item.kind === 'result' ? '■' : item.kind === 'thinking' ? '…' : '·'}
                              </span>
                              <span class="agents-feed-text">
                                {item.text}
                                {item.kind === 'result' && item.costUsd != null ? ` ($${item.costUsd.toFixed(4)})` : ''}
                              </span>
                            </li>
                          )}
                        </For>
                      </ul>
                    }
                  >
                    {/* Gate prompt in the feed (15 P2 / 14): approve/reject → the 6.3 IPC. */}
                    <div class="agents-gate">
                      <p>This workflow is waiting at a human gate: <strong>{stepRow().step.name}</strong></p>
                      <div class="agents-gate-actions">
                        <button type="button" class="overlay-btn" onClick={() => void resolveGate(row(), true)}>Approve</button>
                        <button type="button" class="overlay-btn agents-reject" onClick={() => void resolveGate(row(), false)}>Reject</button>
                      </div>
                    </div>
                  </Show>
                </Show>
                <Show when={row().kind === 'session'}>
                  <p class="muted agents-hint">Interactive session — it lives in the terminal drawer (raw TUI stays the escape hatch).</p>
                </Show>
              </div>
            )
          }}
        </Show>
      </aside>
    </Portal>
  )
}
