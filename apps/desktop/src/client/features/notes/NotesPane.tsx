import { createEffect, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import type { Task, Workspace } from '../../queries'
import { debounce } from '../../autosave'
import { renderMarkdown } from '../integrations/markdown'
import { clearNoteOpen, GLOBAL_NOTES_ID, notesApi, noteToOpen, type NoteScope, type NoteSummary } from './notesClient'
import './notes.css'

// The Notes pane (docs/next 09 P1): .md notes at two SCOPES — this workspace (shared by every
// task/worktree in the group) and GLOBAL (shared across all workspaces). Both render here, grouped
// so the distinction is visible; you pick the scope when creating. List + textarea editor + the
// existing sanitized markdown preview. ponytail: textarea over TipTap; a richer editor only if
// users live in it. Humans only ever create `scratch` notes here; plan/finding/handoff are written
// by agents/workflows (workspace scope) and surface in the collapsible "Agent notes" group.
type Selected = { scope: NoteScope; slug: string }

export default function NotesPane(props: { task: Task; workspace: Workspace | null }) {
  const api = notesApi()
  const wsId = () => props.workspace?.id ?? null
  // The store key for a scope: the workspace's own id, or the reserved global key.
  const keyFor = (scope: NoteScope) => (scope === 'global' ? GLOBAL_NOTES_ID : wsId())
  const [selected, setSelected] = createSignal<Selected | null>(null)
  const [body, setBody] = createSignal('')
  const [preview, setPreview] = createSignal(false)
  const [newTitle, setNewTitle] = createSignal('')
  const [newScope, setNewScope] = createSignal<NoteScope>('workspace')
  const [showAgent, setShowAgent] = createSignal(true)
  const [showGlobal, setShowGlobal] = createSignal(true)

  const [wsList, { refetch: refetchWs }] = createResource(
    () => wsId(),
    async (id) => {
      if (!api || !id) return [] as NoteSummary[]
      const res = await api.list(id)
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )
  // Global notes don't depend on the workspace; keyed on a constant so they load once and refetch.
  const [globalList, { refetch: refetchGlobal }] = createResource(
    () => (api ? GLOBAL_NOTES_ID : null),
    async (id) => {
      const res = await api!.list(id)
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )

  const userNotes = () => (wsList() ?? []).filter((n) => n.author === 'user')
  const agentNotes = () => (wsList() ?? []).filter((n) => n.author !== 'user')
  const globalNotes = () => globalList() ?? []

  const isActive = (scope: NoteScope, slug: string) => selected()?.scope === scope && selected()?.slug === slug
  const refetchScope = (scope: NoteScope) => (scope === 'global' ? refetchGlobal() : refetchWs())

  // Autosave (no Save button): debounce while typing, flush on blur and before we switch away.
  // save() reads selected()+body() at fire time, so flush before mutating selected on a note switch.
  const scheduleSave = debounce(() => void save(), 1500)
  onCleanup(() => scheduleSave.flush())

  // Consume the Context pane's "Edit note" jump: open the requested (workspace) slug editable, once.
  createEffect(() => {
    const slug = noteToOpen()
    if (!slug || !api || !wsId()) return
    setPreview(false)
    void open('workspace', slug)
    clearNoteOpen()
  })

  async function open(scope: NoteScope, slug: string) {
    const id = keyFor(scope)
    if (!api || !id) return
    scheduleSave.flush() // persist the note we're leaving before loading the next
    const res = await api.read(id, slug)
    if ('error' in res) return window.alert(res.error)
    setSelected({ scope, slug })
    setBody(res.body)
  }

  async function save() {
    const sel = selected()
    const id = sel && keyFor(sel.scope)
    if (!api || !sel || !id) return
    const res = await api.write(id, sel.slug, body())
    if ('error' in res) return window.alert(res.error)
  }

  async function create() {
    const scope = newScope()
    const id = keyFor(scope)
    if (!api || !id || !newTitle().trim()) return
    const res = await api.create(id, newTitle().trim()) // humans create scratch only
    if ('error' in res) return window.alert(res.error)
    setNewTitle('')
    await refetchScope(scope)
    await open(scope, res.slug)
  }

  async function remove(scope: NoteScope, slug: string) {
    const id = keyFor(scope)
    if (!api || !id) return
    if (!window.confirm(`Delete note “${slug}”?`)) return
    if (isActive(scope, slug)) {
      scheduleSave.cancel() // don't resurrect the note we're deleting
      setSelected(null)
      setBody('')
    }
    await api.remove(id, slug)
    await refetchScope(scope)
  }

  return (
    <section class="pane notes-pane">
      <div class="section-header">Notes — {props.workspace?.name ?? 'workspace'}</div>
      <Show when={api && wsId()} fallback={<div class="editor-empty muted">Notes need the desktop app and a workspace.</div>}>
        <div class="notes-body">
          <div class="notes-list">
            <For each={userNotes()}>
              {(n) => (
                <div class="notes-row-wrap">
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
                  <option value="workspace">This workspace</option>
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
