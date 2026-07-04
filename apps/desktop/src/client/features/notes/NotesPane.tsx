import { createEffect, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import type { Task, Workspace } from '../../queries'
import { debounce } from '../../autosave'
import { renderMarkdown } from '../integrations/markdown'
import { clearNoteOpen, notesApi, noteToOpen, type NoteSummary } from './notesClient'
import './notes.css'

// The Notes pane (docs/next 09 P1): workspace-scoped .md notes — list + textarea editor + the
// existing sanitized markdown preview. ponytail: textarea over TipTap; a richer editor only if
// users live in it. Notes are workspace-level context: every task/worktree in the group shares them.
// Humans only ever create `scratch` notes here; plan/finding/handoff are written by agents/workflows
// and surface in the collapsible "Agent notes" group below, which only renders when such notes exist.
export default function NotesPane(props: { task: Task; workspace: Workspace | null }) {
  const api = notesApi()
  const wsId = () => props.workspace?.id ?? null
  const [selected, setSelected] = createSignal<string | null>(null)
  const [body, setBody] = createSignal('')
  const [preview, setPreview] = createSignal(false)
  const [newTitle, setNewTitle] = createSignal('')
  const [showAgent, setShowAgent] = createSignal(true)

  const [list, { refetch }] = createResource(
    () => wsId(),
    async (id) => {
      if (!api || !id) return [] as NoteSummary[]
      const res = await api.list(id)
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )

  const userNotes = () => (list() ?? []).filter((n) => n.author === 'user')
  const agentNotes = () => (list() ?? []).filter((n) => n.author !== 'user')

  // Autosave (no Save button): debounce while typing, flush on blur and before we switch away.
  // save() reads selected()+body() at fire time, so flush before mutating selected on a note switch.
  const scheduleSave = debounce(() => void save(), 1500)
  onCleanup(() => scheduleSave.flush())

  // Consume the Context pane's "Edit note" jump: open the requested slug in editable state, once.
  createEffect(() => {
    const slug = noteToOpen()
    if (!slug || !api || !wsId()) return
    setPreview(false)
    void open(slug)
    clearNoteOpen()
  })

  async function open(slug: string) {
    const id = wsId()
    if (!api || !id) return
    scheduleSave.flush() // persist the note we're leaving before loading the next
    const res = await api.read(id, slug)
    if ('error' in res) return window.alert(res.error)
    setSelected(slug)
    setBody(res.body)
  }

  async function save() {
    const id = wsId()
    const slug = selected()
    if (!api || !id || !slug) return
    const res = await api.write(id, slug, body())
    if ('error' in res) return window.alert(res.error)
  }

  async function create() {
    const id = wsId()
    if (!api || !id || !newTitle().trim()) return
    const res = await api.create(id, newTitle().trim()) // humans create scratch only
    if ('error' in res) return window.alert(res.error)
    setNewTitle('')
    await refetch()
    await open(res.slug)
  }

  async function remove(slug: string) {
    const id = wsId()
    if (!api || !id) return
    if (!window.confirm(`Delete note “${slug}”?`)) return
    if (selected() === slug) {
      scheduleSave.cancel() // don't resurrect the note we're deleting
      setSelected(null)
      setBody('')
    }
    await api.remove(id, slug)
    await refetch()
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
                  <button type="button" class="notes-row" classList={{ active: selected() === n.slug }} onClick={() => void open(n.slug)}>
                    <span class="notes-row-title">{n.title}</span>
                  </button>
                  <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove(n.slug)}>✕</button>
                </div>
              )}
            </For>
            <div class="notes-bottom">
              <Show when={agentNotes().length > 0}>
                <button type="button" class="notes-group-header" onClick={() => setShowAgent(!showAgent())}>
                  {showAgent() ? '▾' : '▸'} Agent notes ({agentNotes().length})
                </button>
                <Show when={showAgent()}>
                  <For each={agentNotes()}>
                    {(n) => (
                      <div class="notes-row-wrap">
                        <button type="button" class="notes-row" classList={{ active: selected() === n.slug }} title={`${n.kind} · by ${n.author}`} onClick={() => void open(n.slug)}>
                          <span class="notes-row-kind">{n.kind}</span>
                          <span class="notes-row-title">{n.title}</span>
                          <span class="notes-row-author">{n.author === 'agent' ? '🤖' : '⚙'}</span>
                        </button>
                        <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove(n.slug)}>✕</button>
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
                <input class="integration-key-input" type="text" placeholder="New note title" value={newTitle()} onInput={(e) => setNewTitle(e.currentTarget.value)} />
                <button type="submit" class="overlay-btn" disabled={!newTitle().trim()}>Create</button>
              </form>
            </div>
          </div>
          <div class="notes-main">
            <Show when={selected()} fallback={<div class="editor-empty muted">Select or create a note.</div>}>
              <div class="notes-toolbar">
                <span class="notes-file">{selected()}.md</span>
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
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}
