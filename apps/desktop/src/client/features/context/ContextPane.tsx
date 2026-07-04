import { createResource, createSignal, For, Show } from 'solid-js'
import { readJson } from '../../apiClient'
import type { Task } from '../../queries'
import { taskContextRoute, type TaskContext, type TaskContextInclude } from '../../../shared/api'
import { formatContextBlock } from '../../../shared/contextBlock'
import { agentSessionsFor } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { memoryApi, type MemoryType } from '../memory/memoryClient'
import { requestNoteOpen } from '../notes/notesClient'
import { dispatchLayout } from '../tasks/tasks'
import { DEFAULT_SELECTION, selectionToInclude, traySummary, type TraySelection } from './model'
import './context-tray.css'

const MEMORY_TYPE_OPTIONS: MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

// The Context pane (docs/next 11 §E): a right-rail layout pane listing everything attached to the
// task — PR, linked tickets/errors, notes, top memories — each with an include checkbox, plus
// "Assemble & send → agent" (assembler → formatContextBlock → sendToAgent, gated on the idle edge).
// Was a collapsible bottom tray; promoted to a pane so it gets a full slot (side-by-side) for the
// detail it needs.
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

  // The human gate over auto-generated memory proposals (docs/next 12 P3): accept (with an
  // optional description edit) writes to the task worktree + index; reject leaves no trace.
  const [proposals, { refetch: refetchProposals }] = createResource(
    () => props.task.id,
    async (id) => (memoryApi() ? await memoryApi()!.proposals(id) : []),
    { initialValue: [] },
  )
  const [propEdits, setPropEdits] = createSignal<Record<string, string>>({})

  async function resolveProposal(id: string, approved: boolean) {
    const m = memoryApi()
    if (!m) return
    const p = (proposals() ?? []).find((x) => x.id === id)
    const editedDesc = propEdits()[id]
    const res = await m.resolveProposal(
      id,
      approved,
      approved && p && editedDesc && editedDesc !== p.description ? { name: p.name, type: p.type, description: editedDesc, body: p.body } : undefined,
    )
    if (!res.ok && res.reason) window.alert(res.reason)
    await refetchProposals()
    await refetch()
  }

  // Manual "add memory" (docs/next 12 P1): repo scope → the task worktree (lands via its PR);
  // private scope → ~/.acorn/memory.
  const [memFormOpen, setMemFormOpen] = createSignal(false)
  const [memName, setMemName] = createSignal('')
  const [memDesc, setMemDesc] = createSignal('')
  const [memType, setMemType] = createSignal<MemoryType>('convention')
  const [memScope, setMemScope] = createSignal<'repo' | 'private'>('repo')
  const [memBody, setMemBody] = createSignal('')
  const [memMsg, setMemMsg] = createSignal('')

  async function addMemory() {
    const m = memoryApi()
    if (!m) return
    setMemMsg('')
    const res = await m.add({
      taskId: props.task.id,
      scope: memScope(),
      name: memName().trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      description: memDesc().trim(),
      type: memType(),
      body: memBody(),
    })
    if ('error' in res) return setMemMsg(res.error)
    setMemMsg(`Saved → ${res.path}`)
    setMemName('')
    setMemDesc('')
    setMemBody('')
    await refetch()
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
            <Show when={(proposals() ?? []).length}>
              <div class="context-tray-proposals">
                <span class="muted">Memory proposals (auto-generated — review before they land):</span>
                <For each={proposals() ?? []}>
                  {(p) => (
                    <div class="context-tray-proposal">
                      <span class="context-tray-kind">{p.type}</span>
                      <span class="context-tray-label" title={p.body}>{p.name}</span>
                      <input
                        class="integration-key-input context-tray-proposal-desc"
                        type="text"
                        value={propEdits()[p.id] ?? p.description}
                        onInput={(e) => setPropEdits((prev) => ({ ...prev, [p.id]: e.currentTarget.value }))}
                      />
                      <button type="button" class="overlay-btn" onClick={() => void resolveProposal(p.id, true)}>Accept</button>
                      <button type="button" class="overlay-btn" onClick={() => void resolveProposal(p.id, false)}>Reject</button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="context-tray-actions">
              <button type="button" class="overlay-btn" onClick={() => void refetch()}>Refresh</button>
              <button type="button" class="overlay-btn" onClick={() => void assembleAndSend()}>
                Assemble &amp; send → agent{agentSessionsFor(props.task.id)[0]?.idle ? ' ●' : ''}
              </button>
              <Show when={memoryApi()}>
                <button type="button" class="overlay-btn" onClick={() => setMemFormOpen(!memFormOpen())}>+ memory</button>
              </Show>
            </div>
            <Show when={memFormOpen()}>
              <form
                class="context-tray-memform"
                onSubmit={(e) => {
                  e.preventDefault()
                  void addMemory()
                }}
              >
                <div class="integration-key-row">
                  <input class="integration-key-input" type="text" placeholder="name (kebab-case)" value={memName()} onInput={(e) => setMemName(e.currentTarget.value)} />
                  <select class="integration-key-input" value={memType()} onChange={(e) => setMemType(e.currentTarget.value as MemoryType)}>
                    <For each={MEMORY_TYPE_OPTIONS}>{(k) => <option value={k}>{k}</option>}</For>
                  </select>
                  <select class="integration-key-input" value={memScope()} onChange={(e) => setMemScope(e.currentTarget.value as 'repo' | 'private')}>
                    <option value="repo">repo (worktree, committed)</option>
                    <option value="private">private (~/.acorn)</option>
                  </select>
                </div>
                <input class="integration-key-input" type="text" placeholder="one-line description" value={memDesc()} onInput={(e) => setMemDesc(e.currentTarget.value)} />
                <textarea class="settings-script" rows="3" placeholder={'Body — include a **Why:** line.'} value={memBody()} onInput={(e) => setMemBody(e.currentTarget.value)} />
                <div class="context-tray-actions">
                  <button type="submit" class="overlay-btn" disabled={!memName().trim() || !memDesc().trim()}>Save memory</button>
                  <Show when={memMsg()}><span class="muted">{memMsg()}</span></Show>
                </div>
              </form>
            </Show>
          </div>
        )}
      </Show>
    </section>
  )
}
