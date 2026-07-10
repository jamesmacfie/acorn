import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { Task } from '../../queries'
import type { TerminalProfile } from '../../../shared/terminal'
import { refreshSessions, sessions } from '../terminal/sessions'
import { terminalApi, type WorkflowStepRow } from '../terminal/terminalClient'
import { workflowApi } from './workflowClient'
import { setTerminalOpen } from '../tasks/tasks'
import { buildRoster, resumeCommandFor, stepFeed, type RosterRow } from './model'
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
  // Read-driven refresh: session-status pings + a slow tick while the panel is open.
  onMount(() => {
    const off = api?.onStatus(() => void refetch())
    const timer = setInterval(() => void refetch(), 3000)
    onCleanup(() => {
      off?.()
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
    if (!resume) return window.alert('This step has no resumable session.')
    await api.create({ taskId: props.task.id, profileId: row.step.profileId ?? 'claude-code', command: resume, title: `⏎ ${row.step.name}` })
    await refreshSessions()
    setTerminalOpen(props.task.id, true)
  }

  async function resolveGate(row: RosterRow, approved: boolean) {
    if (!api || row.kind !== 'step') return
    await workflowApi.gate(row.step.runId, row.step.id, approved)
    await refetch()
  }

  return (
    <Portal>
      <aside class="agents-panel">
        <div class="agents-head">
          <span class="agents-title">Agents</span>
          <button type="button" class="overlay-btn" onClick={() => setLauncherOpen(!launcherOpen())}>+ New agent</button>
          <button type="button" class="agents-close" title="Close" onClick={props.onClose}>✕</button>
        </div>
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
                    {row.state}
                    {row.kind === 'step' && row.step.costUsd != null ? ` $${row.step.costUsd.toFixed(2)}` : ''}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>

        <Show when={current()}>
          {(row) => (
            <div class="agents-detail">
              <div class="agents-detail-head">
                <span class="agents-row-title">{row().title}</span>
                <button type="button" class="overlay-btn" onClick={() => void openInTerminal(row())}>
                  {row().kind === 'session' ? 'show terminal' : 'open in terminal'}
                </button>
              </div>
              <Show when={row().kind === 'step' && row().state !== 'unknown'}>
                <Show
                  when={(row() as Extract<RosterRow, { kind: 'step' }>).gate}
                  fallback={
                    <ul class="agents-feed">
                      <For
                        each={stepFeed((row() as Extract<RosterRow, { kind: 'step' }>).step).items}
                        fallback={<li class="muted">No captured activity{(row() as Extract<RosterRow, { kind: 'step' }>).step.status === 'running' ? ' yet — running…' : '.'}</li>}
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
                    <p>This workflow is waiting at a human gate: <strong>{(row() as Extract<RosterRow, { kind: 'step' }>).step.name}</strong></p>
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
          )}
        </Show>
      </aside>
    </Portal>
  )
}

