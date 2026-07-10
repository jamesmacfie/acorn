import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { Task, Workspace } from '../../queries'
import { debounce } from '../../autosave'
import { renderMarkdown } from '../integrations/markdown'
import { notesApi, type NoteLocation, type NoteScope, type NoteSummary } from './notesClient'
import { clientEvents, consumePaneIntent, type PaneIntent } from '../../registries/clientEvents'
import './notes.css'

// The Notes pane (docs/notes-and-memory.md): .md notes at task, workspace and global scopes. They
// render grouped so the storage boundary is visible; task is the safe default for new notes. List + textarea editor + the
// existing sanitized markdown preview. ponytail: textarea over TipTap; a richer editor only if
// users live in it. Humans only ever create `scratch` notes here; plan/finding/handoff are written
// by agents/workflows and surface in their owning scope.
type Selected = { scope: NoteScope; slug: string }

export default function NotesPane(props: { task: Task; workspace: Workspace | null }) {
  const api = notesApi()
  const wsId = () => props.workspace?.id ?? null
  const locationFor = (scope: NoteScope): NoteLocation | null =>
    scope === 'task' ? { scope, taskId: props.task.id } : scope === 'global' ? { scope } : wsId() ? { scope, workspaceId: wsId()! } : null
  const [selected, setSelected] = createSignal<Selected | null>(null)
  const [body, setBody] = createSignal('')
  const [preview, setPreview] = createSignal(false)
  const [newTitle, setNewTitle] = createSignal('')
  const [newScope, setNewScope] = createSignal<NoteScope>('task')
  const [showTask, setShowTask] = createSignal(true)
  const [showAgent, setShowAgent] = createSignal(true)
  const [showGlobal, setShowGlobal] = createSignal(true)
  const [actionError, setActionError] = createSignal('')
  const [deleteArmed, setDeleteArmed] = createSignal('')

  const [taskList, { refetch: refetchTask }] = createResource(
    () => props.task.id,
    async (taskId) => {
      const res = await api.list({ scope: 'task', taskId })
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )
  const [wsList, { refetch: refetchWs }] = createResource(
    () => wsId(),
    async (id) => {
      if (!api || !id) return [] as NoteSummary[]
      const res = await api.list({ scope: 'workspace', workspaceId: id })
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )
  // Global notes don't depend on the workspace; keyed on a constant so they load once and refetch.
  const [globalList, { refetch: refetchGlobal }] = createResource(
    () => (api ? true : null),
    async () => {
      const res = await api!.list({ scope: 'global' })
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )

  const taskNotes = () => taskList() ?? []
  const userNotes = () => (wsList() ?? []).filter((n) => n.author === 'user')
  const agentNotes = () => (wsList() ?? []).filter((n) => n.author !== 'user')
  const globalNotes = () => globalList() ?? []

  const isActive = (scope: NoteScope, slug: string) => selected()?.scope === scope && selected()?.slug === slug
  const refetchScope = (scope: NoteScope) => (scope === 'task' ? refetchTask() : scope === 'global' ? refetchGlobal() : refetchWs())

  // Autosave (no Save button): debounce while typing, flush on blur and before we switch away.
  // save() reads selected()+body() at fire time, so flush before mutating selected on a note switch.
  const scheduleSave = debounce(() => void save(), 1500)
  onCleanup(() => scheduleSave.flush())

  const applyIntent = (intent: PaneIntent | undefined) => {
    if (!intent || intent.kind !== 'notes:open' || !api || (intent.scope === 'workspace' && !wsId())) return
    setPreview(false)
    void open(intent.scope, intent.slug)
  }
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId === props.task.id && paneId === 'notes') applyIntent(intent)
    })
    onCleanup(off)
  })
  createEffect(() => applyIntent(consumePaneIntent(props.task.id, 'notes')))

  async function open(scope: NoteScope, slug: string) {
    const location = locationFor(scope)
    if (!api || !location) return
    scheduleSave.flush() // persist the note we're leaving before loading the next
    const res = await api.read(location, slug)
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    setSelected({ scope, slug })
    setBody(res.body)
  }

  async function save() {
    const sel = selected()
    const location = sel && locationFor(sel.scope)
    if (!api || !sel || !location) return
    const res = await api.write(location, sel.slug, body())
    if ('error' in res) return setActionError(res.error)
    setActionError('')
  }

  async function create() {
    const scope = newScope()
    const location = locationFor(scope)
    if (!api || !location || !newTitle().trim()) return
    const res = await api.create(location, newTitle().trim()) // humans create scratch only
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    setNewTitle('')
    await refetchScope(scope)
    await open(scope, res.slug)
  }

  async function toggleIncluded(scope: NoteScope, slug: string, included: boolean) {
    const location = locationFor(scope)
    if (!api || !location) return
    const res = await api.setIncluded(location, slug, included)
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    await refetchScope(scope)
  }

  async function remove(scope: NoteScope, slug: string) {
    const location = locationFor(scope)
    if (!api || !location) return
    const key = `${scope}:${slug}`
    if (deleteArmed() !== key) {
      setDeleteArmed(key)
      setActionError(`Click delete again to remove “${slug}”.`)
      return
    }
    setDeleteArmed('')
    setActionError('')
    if (isActive(scope, slug)) {
      scheduleSave.cancel() // don't resurrect the note we're deleting
      setSelected(null)
      setBody('')
    }
    const result = await api.remove(location, slug)
    if ('error' in result) return setActionError(result.error)
    await refetchScope(scope)
  }

  return (
    <section class="pane notes-pane">
      <div class="section-header">Notes — {props.workspace?.name ?? 'workspace'}</div>
      <Show when={actionError()}><div class="action-error" role="alert">{actionError()}</div></Show>
      <Show when={api} fallback={<div class="editor-empty muted">Notes need the desktop app.</div>}>
        <div class="notes-body">
          <div class="notes-list">
            <Show when={taskNotes().length > 0}>
              <button type="button" class="notes-group-header" onClick={() => setShowTask(!showTask())}>
                {showTask() ? '▾' : '▸'} Task notes ({taskNotes().length})
              </button>
              <Show when={showTask()}>
                <For each={taskNotes()}>
                  {(n) => (
                    <div class="notes-row-wrap">
                      <input type="checkbox" class="notes-row-include" title={n.included ? 'Included in agent context' : 'Excluded from agent context'} checked={n.included} onChange={(e) => void toggleIncluded('task', n.slug, e.currentTarget.checked)} />
                      <button type="button" class="notes-row" classList={{ active: isActive('task', n.slug) }} title={`${n.kind} · task-scoped`} onClick={() => void open('task', n.slug)}>
                        <span class="notes-row-kind">{n.kind}</span>
                        <span class="notes-row-title">{n.title}</span>
                      </button>
                      <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove('task', n.slug)}>✕</button>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
            <For each={userNotes()}>
              {(n) => (
                <div class="notes-row-wrap">
                  <input type="checkbox" class="notes-row-include" title={n.included ? 'Included in agent context' : 'Excluded from agent context'} checked={n.included} onChange={(e) => void toggleIncluded('workspace', n.slug, e.currentTarget.checked)} />
                  <button type="button" class="notes-row" classList={{ active: isActive('workspace', n.slug) }} onClick={() => void open('workspace', n.slug)}>
                    <span class="notes-row-title">{n.title}</span>
                  </button>
                  <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove('workspace', n.slug)}>✕</button>
                </div>
              )}
            </For>
            <div class="notes-bottom">
              <Show when={globalNotes().length > 0}>
                <button type="button" class="notes-group-header" onClick={() => setShowGlobal(!showGlobal())}>
                  {showGlobal() ? '▾' : '▸'} Global notes ({globalNotes().length})
                </button>
                <Show when={showGlobal()}>
                  <For each={globalNotes()}>
                    {(n) => (
                      <div class="notes-row-wrap">
                        <button type="button" class="notes-row" classList={{ active: isActive('global', n.slug) }} title="Shared across all workspaces" onClick={() => void open('global', n.slug)}>
                          <span class="notes-row-scope" title="Global">🌐</span>
                          <span class="notes-row-title">{n.title}</span>
                        </button>
                        <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove('global', n.slug)}>✕</button>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
              <Show when={agentNotes().length > 0}>
                <button type="button" class="notes-group-header" onClick={() => setShowAgent(!showAgent())}>
                  {showAgent() ? '▾' : '▸'} Agent notes ({agentNotes().length})
                </button>
                <Show when={showAgent()}>
                  <For each={agentNotes()}>
                    {(n) => (
                      <div class="notes-row-wrap">
                        <input type="checkbox" class="notes-row-include" title={n.included ? 'Included in agent context' : 'Excluded from agent context'} checked={n.included} onChange={(e) => void toggleIncluded('workspace', n.slug, e.currentTarget.checked)} />
                        <button type="button" class="notes-row" classList={{ active: isActive('workspace', n.slug) }} title={`${n.kind} · by ${n.author}`} onClick={() => void open('workspace', n.slug)}>
                          <span class="notes-row-kind">{n.kind}</span>
                          <span class="notes-row-title">{n.title}</span>
                          <span class="notes-row-author">{n.author === 'agent' ? '🤖' : '⚙'}</span>
                        </button>
                        <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove('workspace', n.slug)}>✕</button>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
              <form
                class="notes-new"
                onSubmit={(e) => {
                  e.preventDefault()
                  void create()
                }}
              >
                <select class="notes-scope-select" value={newScope()} onChange={(e) => setNewScope(e.currentTarget.value as NoteScope)} title="Note scope">
                  <option value="task">This task</option>
                  <option value="workspace" disabled={!wsId()}>This workspace</option>
                  <option value="global">Global</option>
                </select>
                <input class="integration-key-input" type="text" placeholder="New note title" value={newTitle()} onInput={(e) => setNewTitle(e.currentTarget.value)} />
                <button type="submit" class="overlay-btn" disabled={!newTitle().trim()}>Create</button>
              </form>
            </div>
          </div>
          <div class="notes-main">
            <Show when={selected()} fallback={<div class="editor-empty muted">Select or create a note.</div>}>
              {(sel) => (
                <>
                  <div class="notes-toolbar">
                    <span class="notes-file">
                      <Show when={sel().scope === 'global'}>
                        <span class="notes-row-scope" title="Global note">🌐 </span>
                      </Show>
                      <Show when={sel().scope === 'task'}>
                        <span class="notes-row-scope" title="Task note">◆ </span>
                      </Show>
                      {sel().slug}.md
                    </span>
                    <button type="button" class="editor-save" onClick={() => { scheduleSave.flush(); setPreview(!preview()) }}>{preview() ? 'Edit' : 'Preview'}</button>
                  </div>
                  <Show
                    when={!preview()}
                    fallback={<div class="notes-preview linear-md" innerHTML={renderMarkdown(body())} />}
                  >
                    <textarea
                      class="notes-editor"
                      spellcheck={false}
                      value={body()}
                      onInput={(e) => {
                        setBody(e.currentTarget.value)
                        scheduleSave()
                      }}
                      onBlur={() => scheduleSave.flush()}
                    />
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}
