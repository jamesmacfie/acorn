import { createResource, createSignal, For, Show } from 'solid-js'
import type { Task, Workspace } from '../../queries'
import { renderMarkdown } from '../integrations/markdown'
import { notesApi, type NoteKind, type NoteSummary } from './notesClient'
import './notes.css'

const KIND_OPTIONS: NoteKind[] = ['scratch', 'plan', 'finding', 'handoff']

// The Notes pane (docs/next 09 P1): workspace-scoped .md notes — list + textarea editor + the
// existing sanitized markdown preview. ponytail: textarea over TipTap; a richer editor only if
// users live in it. Notes are workspace-level context: every task/worktree in the group shares them.
export default function NotesPane(props: { task: Task; workspace: Workspace | null }) {
  const api = notesApi()
  const wsId = () => props.workspace?.id ?? null
  const [selected, setSelected] = createSignal<string | null>(null)
  const [body, setBody] = createSignal('')
  const [dirty, setDirty] = createSignal(false)
  const [preview, setPreview] = createSignal(false)
  const [newTitle, setNewTitle] = createSignal('')
  const [newKind, setNewKind] = createSignal<NoteKind>('scratch')

  const [list, { refetch }] = createResource(
    () => wsId(),
    async (id) => {
      if (!api || !id) return [] as NoteSummary[]
      const res = await api.list(id)
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )

  async function open(slug: string) {
    const id = wsId()
    if (!api || !id) return
    if (dirty() && !window.confirm('Discard unsaved note changes?')) return
    const res = await api.read(id, slug)
    if ('error' in res) return window.alert(res.error)
    setSelected(slug)
    setBody(res.body)
    setDirty(false)
  }

  async function save() {
    const id = wsId()
    const slug = selected()
    if (!api || !id || !slug) return
    const res = await api.write(id, slug, body())
    if ('error' in res) return window.alert(res.error)
    setDirty(false)
    await refetch()
  }

  async function create() {
    const id = wsId()
    if (!api || !id || !newTitle().trim()) return
    const res = await api.create(id, newTitle().trim(), newKind())
    if ('error' in res) return window.alert(res.error)
    setNewTitle('')
    await refetch()
    await open(res.slug)
  }

  async function remove(slug: string) {
    const id = wsId()
    if (!api || !id) return
    if (!window.confirm(`Delete note “${slug}”?`)) return
    await api.remove(id, slug)
    if (selected() === slug) {
      setSelected(null)
      setBody('')
      setDirty(false)
    }
    await refetch()
  }

  return (
    <section class="pane notes-pane">
      <div class="section-header">Notes — {props.workspace?.name ?? 'workspace'}</div>
      <Show when={api && wsId()} fallback={<div class="editor-empty muted">Notes need the desktop app and a workspace.</div>}>
        <div class="notes-body">
          <div class="notes-list">
            <For each={list() ?? []}>
              {(n) => (
                <div class="notes-row-wrap">
                  <button type="button" class="notes-row" classList={{ active: selected() === n.slug }} title={`${n.kind} · by ${n.author}`} onClick={() => void open(n.slug)}>
                    <span class="notes-row-kind">{n.kind}</span>
                    <span class="notes-row-title">{n.title}</span>
                    <Show when={n.author !== 'user'}>
                      <span class="notes-row-author">{n.author === 'agent' ? '🤖' : '⚙'}</span>
                    </Show>
                  </button>
                  <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove(n.slug)}>✕</button>
                </div>
              )}
            </For>
            <form
              class="notes-new"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <input class="integration-key-input" type="text" placeholder="New note title" value={newTitle()} onInput={(e) => setNewTitle(e.currentTarget.value)} />
              <select class="integration-key-input" value={newKind()} onChange={(e) => setNewKind(e.currentTarget.value as NoteKind)}>
                <For each={KIND_OPTIONS}>{(k) => <option value={k}>{k}</option>}</For>
              </select>
              <button type="submit" class="overlay-btn" disabled={!newTitle().trim()}>Create</button>
            </form>
          </div>
          <div class="notes-main">
            <Show when={selected()} fallback={<div class="editor-empty muted">Select or create a note.</div>}>
              <div class="notes-toolbar">
                <span class="notes-file">{selected()}.md{dirty() ? ' ●' : ''}</span>
                <button type="button" class="editor-save" onClick={() => setPreview(!preview())}>{preview() ? 'Edit' : 'Preview'}</button>
                <button type="button" class="editor-save" disabled={!dirty()} onClick={() => void save()}>Save</button>
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
                    setDirty(true)
                  }}
                />
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}
