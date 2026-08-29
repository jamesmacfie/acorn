import { createEffect, createResource, createRoot, createSignal, onCleanup, onMount } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import {
  clientEvents,
  consumePaneIntent,
  debounce,
  nodeReady,
  onScopeEvicted,
  toast,
  workspaceForProject,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import { createArmedConfirm } from '@acorn/plugin-api/ui'
import { SCRATCHPAD_SLUG } from '@acorn/protocol/notes.ts'
import { notesApi, type NoteLocation, type NoteScope, type NoteSummary } from './notesClient'
import { notesSelectionFor, rememberNotesSelection } from './notesPaneState'

// Everything the Notes pane knows, held once per task and read by all three of its regions.
//
// The pane is a `list-detail` layout now, so the list, the header above it and the note body are three
// components the host mounts side by side rather than one component with everything in scope. They
// still share a selection, a body, an autosave timer and one set of lists, and the shared thing has to
// outlive any one of them: collapsing the library unmounts the list, and the note being edited must
// not go with it.
//
// So the model lives in its own reactive root, keyed by task. `createRoot` rather than a plain module
// object because the resources and effects below need an owner, and the owner has to be one the host's
// mounting and unmounting cannot take away.
//
// No detached owner is passed, and that is deliberate rather than an oversight. Solid's `createRoot`
// with no second argument still copies the *context* off whichever owner is current, while never
// adding the new root to that owner's `owned` list. So the query client is in scope and disposal stays
// this file's to call. Passing an explicit `null` owner would lose the query client instead.

export type Selected = { scope: NoteScope; slug: string; virtual?: boolean }
export type NotesModel = ReturnType<typeof build>

const roots = new Map<string, { model: NotesModel; dispose: () => void }>()

/** The model for one task, built on first ask. */
export function notesModel(taskId: string, projectId: string | null): NotesModel {
  const held = roots.get(taskId)
  if (held) return held.model
  // One task is on screen at a time, so anything else here is a task somebody navigated away from.
  // Disposing it flushes its pending save through the `onCleanup` below, which is the reason this
  // evicts eagerly rather than waiting for the archive event.
  for (const [id, entry] of roots) if (id !== taskId) { entry.dispose(); roots.delete(id) }
  const entry = createRoot((dispose) => ({ model: build(taskId, projectId), dispose }))
  roots.set(taskId, entry)
  return entry.model
}

onScopeEvicted((event) => {
  if (event.scope !== 'task') return
  roots.get(event.taskId)?.dispose()
  roots.delete(event.taskId)
})

function build(taskId: string, projectId: string | null) {
  const api = notesApi()
  let titleField: HTMLInputElement | undefined
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
  const workspace = () => workspaceForProject(workspaces.data, projectId ?? undefined)
  const wsId = () => workspace()?.id ?? null
  const locationFor = (scope: NoteScope): NoteLocation | null =>
    scope === 'task' ? { scope, taskId } : scope === 'global' ? { scope } : wsId() ? { scope, workspaceId: wsId()! } : null

  const [selected, setSelected] = createSignal<Selected | null>(null)
  const [body, setBody] = createSignal('')
  const [noteTitle, setNoteTitle] = createSignal('')
  const [preview, setPreview] = createSignal(false)
  const [filter, setFilter] = createSignal('')
  const [saving, setSaving] = createSignal(false)
  const [actionError, setActionError] = createSignal('')
  // The armed button is the prompt; this used to be written into the error banner.
  const deleteArmed = createArmedConfirm()
  const [landed, setLanded] = createSignal(false)
  let scratchCreate: Promise<void> | null = null

  const [taskList, { refetch: refetchTask }] = createResource(
    () => taskId,
    async (id) => {
      const res = await api.list({ scope: 'task', taskId: id })
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

  const matches = (note: NoteSummary) => {
    const needle = filter().trim().toLowerCase()
    return !needle || note.title.toLowerCase().includes(needle) || note.slug.toLowerCase().includes(needle)
  }
  // docs/notes-and-memory.md § Notes explains why this checks kind, not just author.
  const notSeed = (note: NoteSummary) => !(note.author === 'workflow' && note.kind === 'scratch')
  const taskNotes = () => taskList() ?? []
  const scratchpad = () => taskNotes().find((note) => note.slug === SCRATCHPAD_SLUG)
  const taskOther = () => taskNotes().filter((note) => note.slug !== SCRATCHPAD_SLUG && notSeed(note) && matches(note))
  const wsNotes = () => (wsList() ?? []).filter((note) => notSeed(note) && matches(note))
  const globalNotes = () => (globalList() ?? []).filter((note) => notSeed(note) && matches(note))

  const isActive = (scope: NoteScope, slug: string) => selected()?.scope === scope && selected()?.slug === slug
  const refetchScope = (scope: NoteScope) => (scope === 'task' ? refetchTask() : scope === 'global' ? refetchGlobal() : refetchWs())

  const selectedSummary = (): NoteSummary | undefined => {
    const sel = selected()
    if (!sel || sel.virtual) return undefined
    const list = sel.scope === 'task' ? taskNotes() : sel.scope === 'workspace' ? (wsList() ?? []) : globalNotes()
    return list.find((note) => note.slug === sel.slug)
  }
  const selectedIncluded = () => selectedSummary()?.included ?? true

  // Autosave: debounce while typing, flush on blur and before we switch away. save() reads
  // selected()+body() at fire time, so flush before mutating selected on a note switch.
  const scheduleSave = debounce(() => void save(), 1500)
  const scheduleTitle = debounce(() => void saveTitle(), 800)
  onCleanup(() => scheduleSave.flush())

  // Land the pane: retained notes:open intent wins, then the remembered note, else the scratchpad.
  createEffect(() => {
    if (!api || taskList.loading || landed()) return
    setLanded(true)
    const intent = consumePaneIntent(taskId, 'notes')
    if (intent && intent.kind === 'notes:open' && (intent.scope !== 'workspace' || wsId())) return void open(intent.scope, intent.slug)
    const remembered = notesSelectionFor(taskId)
    if (remembered) return void open(remembered.scope, remembered.slug)
    landScratchpad()
  })

  // Live intents arriving while mounted (openPane after the pane is already up).
  onMount(() => {
    const off = clientEvents.on('presentation:pane-intent', (event) => {
      if (event.taskId !== taskId || event.paneId !== 'notes' || event.intent.kind !== 'notes:open') return
      if (event.intent.scope === 'workspace' && !wsId()) return
      void open(event.intent.scope, event.intent.slug)
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
  }

  // First keystroke in a virtual scratchpad creates the file (single-flight). Adopt an existing
  // scratchpad slug if the list already has one; adopt a deduped slug if create renamed it.
  function ensureScratchpad(): Promise<void> {
    if (scratchCreate) return scratchCreate
    scratchCreate = (async () => {
      const existing = scratchpad()
      if (existing) {
        setSelected({ scope: 'task', slug: existing.slug })
        rememberNotesSelection(taskId, { scope: 'task', slug: existing.slug })
        return
      }
      const res = await api.create({ scope: 'task', taskId }, 'Scratchpad', 'scratch')
      if ('error' in res) {
        setActionError(res.error)
        scratchCreate = null
        return
      }
      setSelected({ scope: 'task', slug: res.slug })
      rememberNotesSelection(taskId, { scope: 'task', slug: res.slug })
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
    rememberNotesSelection(taskId, { scope, slug })
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
    toast('Note saved', { tone: 'success' })
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

  async function createIn(scope: NoteScope): Promise<boolean> {
    const location = locationFor(scope)
    if (!api || !location) return false
    const res = await api.create(location, 'Untitled')
    if ('error' in res) {
      setActionError(res.error)
      return false
    }
    setActionError('')
    await refetchScope(scope)
    await open(scope, res.slug)
    return true
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
    if (!deleteArmed.request(`${scope}:${slug}`)) return
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
    if (selected()?.virtual) void ensureScratchpad().then(() => scheduleSave())
    else scheduleSave()
  }

  function onTitleInput(value: string) {
    setNoteTitle(value)
    if (selected()?.virtual) void ensureScratchpad().then(() => scheduleTitle())
    else scheduleTitle()
  }

  return {
    taskId,
    // The title field's element, held by the model rather than by the list, because the two are in
    // different regions the host mounts independently: the "+" that creates a note is in the list and
    // the field it wants focused is in the detail.
    titleRef: (element: HTMLInputElement) => { titleField = element },
    requestTitleFocus: () => queueMicrotask(() => { titleField?.focus(); titleField?.select() }),
    api,
    workspace,
    locationFor,
    selected,
    body,
    noteTitle,
    preview,
    setPreview,
    filter,
    setFilter,
    saving,
    actionError,
    deleteArmed,
    matches,
    scratchpad,
    taskOther,
    wsNotes,
    globalNotes,
    isActive,
    selectedIncluded,
    scheduleSave,
    landScratchpad,
    open,
    createIn,
    toggleIncluded,
    remove,
    onBodyInput,
    onTitleInput,
  }
}
