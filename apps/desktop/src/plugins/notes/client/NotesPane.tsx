import { createEffect, createSignal, createResource, For, onCleanup, onMount, Show } from 'solid-js'
import type { Task, Workspace } from '../../../core/client/queries'
import { debounce } from '../../editor/client/autosave'
import { renderMarkdown } from '../../../core/client/integrations/markdown'
import { bytesOf, formatSize } from '../../context/client/model'
import { notesApi, type NoteLocation, type NoteScope, type NoteSummary } from './notesClient'
import { SCRATCHPAD_SLUG } from '../../../core/shared/notes'
import { clientEvents, consumePaneIntent, openPane } from '../../../core/client/registries/clientEvents'
import { libraryCollapsed, notesSelectionFor, rememberNotesSelection, setLibraryCollapsed } from './notesPaneState'
import './notes.css'

// The Notes pane (docs/next/context-ui.md): where you write context. Lands in this task's
// scratchpad (a *virtual* note until the first keystroke creates the file); a library column
// grouped Task / Workspace / Global with agent/seeded notes badged in place, a filter, per-group
// create, an include dot per row, rename, and "view in Context". Autosave discipline unchanged:
// debounce(save, 1500), flush on blur/switch/cleanup, cancel on delete. renderMarkdown preview kept.
type Selected = { scope: NoteScope; slug: string; virtual?: boolean }

const scopeGlyph = (scope: NoteScope): string => (scope === 'task' ? '◆ task' : scope === 'workspace' ? 'ws' : '🌐')
const authorBadge = (author: NoteSummary['author']): string => (author === 'agent' ? '🤖' : author === 'workflow' ? 'seed' : '')

export default function NotesPane(props: { task: Task; workspace: Workspace | null }) {
  const api = notesApi()
  const wsId = () => props.workspace?.id ?? null
  const locationFor = (scope: NoteScope): NoteLocation | null =>
    scope === 'task' ? { scope, taskId: props.task.id } : scope === 'global' ? { scope } : wsId() ? { scope, workspaceId: wsId()! } : null

  const [selected, setSelected] = createSignal<Selected | null>(null)
  const [body, setBody] = createSignal('')
  const [noteTitle, setNoteTitle] = createSignal('')
  const [preview, setPreview] = createSignal(false)
  const [filter, setFilter] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  const [savedOnce, setSavedOnce] = createSignal(false)
  const [actionError, setActionError] = createSignal('')
  const [deleteArmed, setDeleteArmed] = createSignal('')
  const [landedTask, setLandedTask] = createSignal('')
  let titleInputRef: HTMLInputElement | undefined
  let scratchCreate: Promise<void> | null = null

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
  const [globalList, { refetch: refetchGlobal }] = createResource(
    () => (api ? true : null),
    async () => {
      const res = await api!.list({ scope: 'global' })
      return 'error' in res ? [] : res
    },
    { initialValue: [] },
  )

  const matches = (n: NoteSummary) => {
    const f = filter().trim().toLowerCase()
    return !f || n.title.toLowerCase().includes(f) || n.slug.toLowerCase().includes(f)
  }
  // External snapshots (PR description / comments / ticket) are seeded as workflow-authored scratch
  // notes. They belong to context (the PR/issues sections + assembled block), not this editing pane,
  // so keep them out of the library. Workflow handoffs are workflow-authored too but kind 'finding',
  // so they stay. (docs/next/context-ui.md)
  const notSeed = (n: NoteSummary) => !(n.author === 'workflow' && n.kind === 'scratch')
  const taskNotes = () => taskList() ?? []
  const scratchpad = () => taskNotes().find((n) => n.slug === SCRATCHPAD_SLUG)
  const taskOther = () => taskNotes().filter((n) => n.slug !== SCRATCHPAD_SLUG && notSeed(n) && matches(n))
  const wsNotes = () => (wsList() ?? []).filter((n) => notSeed(n) && matches(n))
  const globalNotes = () => (globalList() ?? []).filter((n) => notSeed(n) && matches(n))

  const isActive = (scope: NoteScope, slug: string) => selected()?.scope === scope && selected()?.slug === slug
  const refetchScope = (scope: NoteScope) => (scope === 'task' ? refetchTask() : scope === 'global' ? refetchGlobal() : refetchWs())
  const collapsed = () => libraryCollapsed(props.task.id)

  const selectedSummary = (): NoteSummary | undefined => {
    const sel = selected()
    if (!sel || sel.virtual) return undefined
    const list = sel.scope === 'task' ? taskNotes() : sel.scope === 'workspace' ? (wsList() ?? []) : globalNotes()
    return list.find((n) => n.slug === sel.slug)
  }
  const selectedIncluded = () => selectedSummary()?.included ?? true

  // Autosave: debounce while typing, flush on blur and before we switch away. save() reads
  // selected()+body() at fire time, so flush before mutating selected on a note switch.
  const scheduleSave = debounce(() => void save(), 1500)
  const scheduleTitle = debounce(() => void saveTitle(), 800)
  onCleanup(() => scheduleSave.flush())

  // Land the pane: retained notes:open intent wins, then the remembered note, else the scratchpad.
  createEffect(() => {
    const taskId = props.task.id
    const ready = !taskList.loading
    if (!api || !ready || landedTask() === taskId) return
    setLandedTask(taskId)
    scratchCreate = null
    const intent = consumePaneIntent(taskId, 'notes')
    if (intent && intent.kind === 'notes:open' && (intent.scope !== 'workspace' || wsId())) return void open(intent.scope, intent.slug)
    const remembered = notesSelectionFor(taskId)
    if (remembered) return void open(remembered.scope, remembered.slug)
    landScratchpad()
  })

  // Live intents arriving while mounted (openPane after the pane is already up).
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', ({ taskId, paneId, intent }) => {
      if (taskId !== props.task.id || paneId !== 'notes' || intent.kind !== 'notes:open') return
      if (intent.scope === 'workspace' && !wsId()) return
      void open(intent.scope, intent.slug)
    })
    onCleanup(off)
  })

  function landScratchpad() {
    setPreview(false)
    const existing = scratchpad()
    if (existing) return void open('task', existing.slug)
    setSelected({ scope: 'task', slug: SCRATCHPAD_SLUG, virtual: true })
    setNoteTitle('Scratchpad')
    setBody('')
    setSavedOnce(false)
  }

  // First keystroke in a virtual scratchpad creates the file (single-flight). Adopt an existing
  // scratchpad slug if the list already has one; adopt a deduped slug if create renamed it.
  function ensureScratchpad(): Promise<void> {
    if (scratchCreate) return scratchCreate
    scratchCreate = (async () => {
      const existing = scratchpad()
      if (existing) {
        setSelected({ scope: 'task', slug: existing.slug })
        rememberNotesSelection(props.task.id, { scope: 'task', slug: existing.slug })
        return
      }
      const res = await api.create({ scope: 'task', taskId: props.task.id }, 'Scratchpad', 'scratch')
      if ('error' in res) {
        setActionError(res.error)
        scratchCreate = null
        return
      }
      setSelected({ scope: 'task', slug: res.slug })
      rememberNotesSelection(props.task.id, { scope: 'task', slug: res.slug })
      await refetchTask()
    })()
    return scratchCreate
  }

  async function open(scope: NoteScope, slug: string) {
    const location = locationFor(scope)
    if (!api || !location) return
    scheduleSave.flush() // persist the note we're leaving before loading the next
    const res = await api.read(location, slug)
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    setPreview(false)
    setSelected({ scope, slug })
    setBody(res.body)
    setNoteTitle(res.title)
    setSaving(false)
    setSavedOnce(false)
    rememberNotesSelection(props.task.id, { scope, slug })
  }

  async function save() {
    const sel = selected()
    const location = sel && locationFor(sel.scope)
    if (!api || !sel || sel.virtual || !location) return
    setSaving(true)
    const res = await api.write(location, sel.slug, body())
    setSaving(false)
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    setSavedOnce(true)
  }

  async function saveTitle() {
    const sel = selected()
    const location = sel && locationFor(sel.scope)
    if (!api || !sel || sel.virtual || !location || !noteTitle().trim()) return
    const res = await api.setTitle(location, sel.slug, noteTitle().trim())
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    await refetchScope(sel.scope)
  }

  async function createIn(scope: NoteScope) {
    const location = locationFor(scope)
    if (!api || !location) return
    const res = await api.create(location, 'Untitled')
    if ('error' in res) return setActionError(res.error)
    setActionError('')
    await refetchScope(scope)
    await open(scope, res.slug)
    queueMicrotask(() => {
      titleInputRef?.focus()
      titleInputRef?.select()
    })
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
      scheduleSave.cancel()
      landScratchpad()
    }
    const result = await api.remove(location, slug)
    if ('error' in result) return setActionError(result.error)
    await refetchScope(scope)
  }

  function onBodyInput(value: string) {
    setBody(value)
    setSavedOnce(false)
    if (selected()?.virtual) void ensureScratchpad().then(() => scheduleSave())
    else scheduleSave()
  }

  const IncludeDot = (dotProps: { scope: NoteScope; note: NoteSummary }) => (
    <button
      type="button"
      class="notes-include-dot"
      classList={{ on: dotProps.note.included }}
      title={dotProps.note.included ? 'Included in agent context' : 'Excluded from agent context'}
      onClick={() => void toggleIncluded(dotProps.scope, dotProps.note.slug, !dotProps.note.included)}
    />
  )

  const NoteRow = (rowProps: { scope: NoteScope; note: NoteSummary; pinned?: boolean }) => (
    <div class="notes-row-wrap">
      <IncludeDot scope={rowProps.scope} note={rowProps.note} />
      <button type="button" class="notes-row" classList={{ active: isActive(rowProps.scope, rowProps.note.slug) }} onClick={() => void open(rowProps.scope, rowProps.note.slug)}>
        <span class="notes-row-title">{rowProps.note.title}</span>
        <Show when={authorBadge(rowProps.note.author)}><span class="notes-row-author">{authorBadge(rowProps.note.author)}</span></Show>
      </button>
      <button type="button" class="notes-row-delete" title="Delete note" onClick={() => void remove(rowProps.scope, rowProps.note.slug)}>✕</button>
    </div>
  )

  const GroupHeader = (headProps: { label: string; count: number; scope: NoteScope }) => (
    <div class="notes-group-head">
      <span class="notes-group-label">{headProps.label} ({headProps.count})</span>
      <button type="button" class="notes-group-add" title={`New ${headProps.label} note`} disabled={!locationFor(headProps.scope)} onClick={() => void createIn(headProps.scope)}>+</button>
    </div>
  )

  return (
    <section class="pane notes-pane">
      <div class="section-header notes-header">
        <span>Notes — {props.workspace?.name ?? 'workspace'}</span>
        <input class="notes-filter" type="text" placeholder="filter…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        <button type="button" class="notes-collapse" title={collapsed() ? 'Show library' : 'Hide library'} onClick={() => setLibraryCollapsed(props.task.id, !collapsed())}>{collapsed() ? '▶' : '◀'}</button>
      </div>
      <Show when={actionError()}><div class="action-error" role="alert">{actionError()}</div></Show>
      <Show when={api} fallback={<div class="editor-empty muted">Notes need the desktop app.</div>}>
        <div class="notes-body" classList={{ 'library-collapsed': collapsed() }}>
          <div class="notes-list">
            <GroupHeader label="Task" count={taskOther().length + 1} scope="task" />
            <Show when={!scratchpad() && matches({ slug: SCRATCHPAD_SLUG, title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0 })}>
              <div class="notes-row-wrap">
                <span class="notes-include-dot placeholder" />
                <button type="button" class="notes-row" classList={{ active: isActive('task', SCRATCHPAD_SLUG) }} onClick={() => landScratchpad()}>
                  <span class="notes-row-title">Scratchpad</span>
                </button>
              </div>
            </Show>
            <Show when={scratchpad()}>{(n) => <NoteRow scope="task" note={n()} pinned />}</Show>
            <For each={taskOther()}>{(n) => <NoteRow scope="task" note={n} />}</For>

            <GroupHeader label="Workspace" count={wsNotes().length} scope="workspace" />
            <For each={wsNotes()}>{(n) => <NoteRow scope="workspace" note={n} />}</For>

            <GroupHeader label="Global" count={globalNotes().length} scope="global" />
            <For each={globalNotes()}>{(n) => <NoteRow scope="global" note={n} />}</For>
          </div>

          <div class="notes-main">
            <Show when={selected()} fallback={<div class="editor-empty muted">Select or create a note.</div>}>
              {(sel) => (
                <>
                  <div class="notes-toolbar">
                    <input
                      ref={titleInputRef}
                      class="notes-title-input"
                      type="text"
                      value={noteTitle()}
                      placeholder="Untitled"
                      onInput={(e) => {
                        setNoteTitle(e.currentTarget.value)
                        if (sel().virtual) void ensureScratchpad().then(() => scheduleTitle())
                        else scheduleTitle()
                      }}
                    />
                    <span class="notes-scope-pill" title={`${sel().scope} scope`}>{scopeGlyph(sel().scope)}</span>
                    <button
                      type="button"
                      class="notes-include-dot"
                      classList={{ on: selectedIncluded() }}
                      title={selectedIncluded() ? 'Included in agent context' : 'Excluded from agent context'}
                      disabled={sel().virtual}
                      onClick={() => void toggleIncluded(sel().scope, sel().slug, !selectedIncluded())}
                    />
                    <button type="button" class="editor-save" onClick={() => { scheduleSave.flush(); setPreview(!preview()) }}>{preview() ? 'Edit' : 'Preview'}</button>
                    <span class="notes-save-state muted">{saving() ? 'saving…' : savedOnce() ? 'saved ·' : ''}</span>
                  </div>
                  <Show when={!preview()} fallback={<div class="notes-preview linear-md" innerHTML={renderMarkdown(body())} />}>
                    <textarea
                      class="notes-editor"
                      spellcheck={false}
                      value={body()}
                      onInput={(e) => onBodyInput(e.currentTarget.value)}
                      onBlur={() => scheduleSave.flush()}
                    />
                  </Show>
                  <div class="notes-footer">
                    <span class="muted">{formatSize(bytesOf(body()))}</span>
                    <button
                      type="button"
                      class="notes-view-context"
                      disabled={sel().virtual}
                      onClick={() => openPane(props.task.id, 'context', { kind: 'context:reveal', sectionId: 'notes', itemId: `${sel().scope}:${sel().slug}` })}
                    >
                      view in Context →
                    </button>
                  </div>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}
