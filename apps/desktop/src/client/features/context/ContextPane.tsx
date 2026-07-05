import { createResource, createSignal, For, Show } from 'solid-js'
import { readJson } from '../../apiClient'
import type { Task } from '../../queries'
import { taskContextRoute, type TaskContext, type TaskContextInclude } from '../../../shared/api'
import { formatContextBlock } from '../../../shared/contextBlock'
import { agentSessionsFor } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import MemoryTray from '../memory/MemoryTray'
import { requestNoteOpen } from '../notes/notesClient'
import { dispatchLayout } from '../tasks/tasks'
import { DEFAULT_SELECTION, selectionToInclude, traySummary, type TraySelection } from './model'
import './context-tray.css'

// The Context pane (docs/next 11 §E): a right-rail layout pane listing everything attached to the
// task — PR, linked tickets/errors, notes, top memories — each with an include checkbox, plus
// "Assemble & send → agent" (assembler → formatContextBlock → sendToAgent, gated on the idle edge).
// Was a collapsible bottom tray; promoted to a pane so it gets a full slot (side-by-side) for the
// detail it needs. The memory surfaces (proposal gate + manual "+ memory" form) live in MemoryTray
// (features/memory) — this pane keeps assembly/send as its one job.
export default function ContextPane(props: { task: Task }) {
  const api = terminalApi()
  const [sel, setSel] = createSignal<TraySelection>({ ...DEFAULT_SELECTION })
  const [msg, setMsg] = createSignal('')

  // Full context for display; the send fetches again with the curated include param.
  const [ctx, { refetch }] = createResource(
    () => props.task.id,
    (id) => readJson<TaskContext>(taskContextRoute(id)),
  )

  const toggle = (k: TaskContextInclude) => setSel((s) => ({ ...s, [k]: !s[k] }))

  // Per-item expand/collapse — the pane lists what's attached; a click reveals the detail.
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const isOpen = (id: string) => expanded().has(id)
  const toggleOpen = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // "Edit" jumps to the note in the Notes pane (opens/loads it there in editable state).
  function editNote(slug: string) {
    requestNoteOpen(slug)
    dispatchLayout(props.task.id, { type: 'show', pane: 'notes' })
  }

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
    <section class="pane context-pane">
      <div class="section-header context-tray-head">
        <span>context</span>
        <span class="muted">{traySummary(ctx())}</span>
        <Show when={msg()}>
          <span class="muted context-tray-msg">{msg()}</span>
        </Show>
      </div>
      <Show when={ctx()}>
        {(c) => (
          <div class="context-tray-body">
            <Show when={c().pr}>
              {(pr) => (
                <div class="context-tray-item">
                  <div class="context-tray-row">
                    <input type="checkbox" checked={sel().pr} onChange={() => toggle('pr')} />
                    <span class="context-tray-kind">PR</span>
                    <button type="button" class="context-tray-expand" onClick={() => toggleOpen('pr')}>
                      <span class="context-tray-twist">{isOpen('pr') ? '▾' : '▸'}</span>
                      <span class="context-tray-label">#{pr().number} {pr().title}</span>
                    </button>
                  </div>
                  <Show when={isOpen('pr')}>
                    <div class="context-tray-detail">
                      <Show when={pr().body}><div class="context-tray-detail-body">{pr().body}</div></Show>
                      <Show when={pr().changedFiles.length}>
                        <div class="muted">{pr().changedFiles.length} changed file{pr().changedFiles.length === 1 ? '' : 's'}</div>
                        <ul class="context-tray-files"><For each={pr().changedFiles}>{(f) => <li>{f}</li>}</For></ul>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            <For each={c().issues}>
              {(issue) => (
                <div class="context-tray-item">
                  <div class="context-tray-row">
                    <input type="checkbox" checked={sel().issues} onChange={() => toggle('issues')} />
                    <span class="context-tray-kind">{issue.provider}</span>
                    <button type="button" class="context-tray-expand" onClick={() => toggleOpen(`issue:${issue.identifier}`)}>
                      <span class="context-tray-twist">{isOpen(`issue:${issue.identifier}`) ? '▾' : '▸'}</span>
                      <span class="context-tray-label">{issue.identifier} — {issue.title}{issue.detail ? ` (${issue.detail})` : ''}</span>
                    </button>
                  </div>
                  <Show when={isOpen(`issue:${issue.identifier}`)}>
                    <div class="context-tray-detail">
                      <div class="context-tray-detail-body">{issue.identifier} — {issue.title}</div>
                      <Show when={issue.detail}><div class="muted">status: {issue.detail}</div></Show>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <For each={c().notes}>
              {(note) => {
                const id = `note:${note.slug ?? note.title}`
                return (
                  <div class="context-tray-item">
                    <div class="context-tray-row">
                      <input type="checkbox" checked={sel().notes} onChange={() => toggle('notes')} />
                      <span class="context-tray-kind">notes</span>
                      <button type="button" class="context-tray-expand" onClick={() => toggleOpen(id)}>
                        <span class="context-tray-twist">{isOpen(id) ? '▾' : '▸'}</span>
                        <span class="context-tray-label">{note.title}</span>
                      </button>
                      <Show when={note.slug}>
                        <button type="button" class="context-tray-edit" title="Edit in Notes" aria-label="Edit in Notes" onClick={() => editNote(note.slug!)}>✎</button>
                      </Show>
                    </div>
                    <Show when={isOpen(id)}>
                      <div class="context-tray-detail"><div class="context-tray-detail-body">{note.body}</div></div>
                    </Show>
                  </div>
                )
              }}
            </For>
            <For each={c().memory}>
              {(mem) => (
                <div class="context-tray-item">
                  <div class="context-tray-row">
                    <input type="checkbox" checked={sel().memory} onChange={() => toggle('memory')} />
                    <span class="context-tray-kind">memory</span>
                    <button type="button" class="context-tray-expand" onClick={() => toggleOpen(`mem:${mem.name}`)}>
                      <span class="context-tray-twist">{isOpen(`mem:${mem.name}`) ? '▾' : '▸'}</span>
                      <span class="context-tray-label">{mem.name}</span>
                    </button>
                  </div>
                  <Show when={isOpen(`mem:${mem.name}`)}>
                    <div class="context-tray-detail"><div class="context-tray-detail-body">{mem.description}</div></div>
                  </Show>
                </div>
              )}
            </For>
            <div class="context-tray-actions">
              <button type="button" class="overlay-btn" onClick={() => void refetch()}>Refresh</button>
              <button type="button" class="overlay-btn" onClick={() => void assembleAndSend()}>
                Assemble &amp; send → agent{agentSessionsFor(props.task.id)[0]?.idle ? ' ●' : ''}
              </button>
            </div>
            <MemoryTray task={props.task} onChanged={() => void refetch()} />
          </div>
        )}
      </Show>
    </section>
  )
}
