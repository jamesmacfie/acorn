import { createResource, createSignal, For, Show } from 'solid-js'
import { readJson } from '../../apiClient'
import type { Task } from '../../queries'
import { taskContextRoute, type TaskContext, type TaskContextInclude } from '../../../shared/api'
import { formatContextBlock } from '../../../shared/contextBlock'
import { agentSessionsFor } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { DEFAULT_SELECTION, selectionToInclude, traySummary, type TraySelection } from './model'
import './context-tray.css'

// The context tray (docs/next 11 §E): collapsible chrome above the task footer listing everything
// attached to the task — PR, linked tickets/errors, notes, top memories — each with an include
// checkbox, plus "Assemble & send → agent" (assembler → formatContextBlock → sendToAgent, gated on
// the idle edge). Open by default; collapses to the one-line summary so it never becomes a fifth
// always-on surface.
export default function ContextTray(props: { task: Task }) {
  const api = terminalApi()
  const [open, setOpen] = createSignal(true)
  const [sel, setSel] = createSignal<TraySelection>({ ...DEFAULT_SELECTION })
  const [msg, setMsg] = createSignal('')

  // Full context for display; the send fetches again with the curated include param.
  const [ctx, { refetch }] = createResource(
    () => props.task.id,
    (id) => readJson<TaskContext>(taskContextRoute(id)),
  )

  const toggle = (k: TaskContextInclude) => setSel((s) => ({ ...s, [k]: !s[k] }))

  async function assembleAndSend() {
    setMsg('')
    const include = selectionToInclude(sel())
    if (!include.length) return setMsg('Nothing selected.')
    const target = agentSessionsFor(props.task.id)[0]
    if (!target || !api) return setMsg('No running agent session.')
    const assembled = await readJson<TaskContext>(taskContextRoute(props.task.id, include))
    const res = await api.sendToAgent(target.id, formatContextBlock(assembled), 'after-ready')
    setMsg(res.ok ? (res.queued ? 'Queued — delivers when the agent is idle.' : 'Sent.') : (res.reason ?? 'Send failed.'))
  }

  return (
    <div class="context-tray">
      <button type="button" class="context-tray-head" onClick={() => setOpen(!open())} title="Context tray — what an assembled send includes">
        <span class="context-tray-twist">{open() ? '▾' : '▸'}</span>
        <span>context</span>
        <span class="muted">{traySummary(ctx())}</span>
        <Show when={msg()}>
          <span class="muted context-tray-msg">{msg()}</span>
        </Show>
      </button>
      <Show when={open() && ctx()}>
        {(c) => (
          <div class="context-tray-body">
            <Show when={c().pr}>
              {(pr) => (
                <label class="context-tray-row">
                  <input type="checkbox" checked={sel().pr} onChange={() => toggle('pr')} />
                  <span class="context-tray-kind">PR</span>
                  <span class="context-tray-label">#{pr().number} {pr().title}</span>
                </label>
              )}
            </Show>
            <For each={c().issues}>
              {(issue) => (
                <label class="context-tray-row">
                  <input type="checkbox" checked={sel().issues} onChange={() => toggle('issues')} />
                  <span class="context-tray-kind">{issue.provider}</span>
                  <span class="context-tray-label">{issue.identifier} — {issue.title}{issue.detail ? ` (${issue.detail})` : ''}</span>
                </label>
              )}
            </For>
            <Show when={c().notes.length}>
              <label class="context-tray-row">
                <input type="checkbox" checked={sel().notes} onChange={() => toggle('notes')} />
                <span class="context-tray-kind">notes</span>
                <span class="context-tray-label">{c().notes.map((n) => `“${n.title}”`).join(' · ')}</span>
              </label>
            </Show>
            <Show when={c().memory.length}>
              <label class="context-tray-row">
                <input type="checkbox" checked={sel().memory} onChange={() => toggle('memory')} />
                <span class="context-tray-kind">memory</span>
                <span class="context-tray-label">{c().memory.length} repo memories ({c().memory.slice(0, 3).map((m) => m.name).join(', ')}{c().memory.length > 3 ? ', …' : ''})</span>
              </label>
            </Show>
            <div class="context-tray-actions">
              <button type="button" class="overlay-btn" onClick={() => void refetch()}>Refresh</button>
              <button type="button" class="overlay-btn" onClick={() => void assembleAndSend()}>
                Assemble &amp; send → agent{agentSessionsFor(props.task.id)[0]?.idle ? ' ●' : ''}
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
