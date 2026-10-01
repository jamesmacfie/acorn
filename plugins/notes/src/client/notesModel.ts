import { createEffect, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  queryOwner,
  readJson,
  clientEvents,
  consumePaneIntent,
  debounce,
  nodeReady,
  toast,
  workspaceForProject,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import { workspacesRoute, type Workspace } from '@acorn/protocol/api.ts'
import { noteDraft, type NoteDraft } from './noteDrafts'
import { SCRATCHPAD_SLUG } from '@acorn/protocol/notes.ts'
import { notesApi, type NoteLocation, type NoteScope, type NoteSummary } from './notesClient'
import { notesSelectionFor, rememberNotesSelection } from './notesPaneState'

// Everything the Notes pane knows, held once per task and read by all three of its regions.
//
// The pane is a `list-detail` layout, so the list, the header above it and the note body are three
// components the host mounts side by side rather than one component with everything in scope. They
// still share a selection, a body, an autosave timer and one set of lists, and the shared thing has to
// outlive any one of them: collapsing the library unmounts the list, and the note being edited must
// not go with it.
//
// The host holds it. `model` on the pane contribution builds this once per task inside its own
// reactive root and hands it to every region (client-core registries/paneModels.ts, docs/panes.md §
// Layout model). This file used to keep that root map itself, and so did changes, agents and context.

export type Selected = { scope: NoteScope; slug: string; virtual?: boolean }
export type NotesModel = ReturnType<typeof createNotesModel>

export function createNotesModel(taskId: string, projectId: string | null) {
  const owner = queryOwner(useQueryClient())
  const nodeId = owner === undefined ? activeNodeId() : owner
  const api = notesApi(nodeId)
  let disposed = false
  let selectionRevision = 0
  let document: { location: NoteLocation; slug: string; draft: NoteDraft; release(): void; virtual?: boolean } | null = null
  const adoptDocument = (next: { location: NoteLocation; slug: string; draft: NoteDraft; virtual?: boolean }) => {
    const release = next.draft.retain()
    document?.release()
    document = { ...next, release }
  }
  const live = () => !disposed && activeNodeId() === nodeId
  let titleField: HTMLInputElement | undefined
  const workspaces = createQuery(() => ({ ...workspacesOptions(nodeReady()), queryFn: ({ signal }) => readJson<Workspace[]>(workspacesRoute, { nodeId, signal }) }))
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
  // Each save captures the selected document owner. Flush again after held reads before replacing it.
  const scheduleSave = debounce(() => void save(), 1500)
  const scheduleTitle = debounce(() => void saveTitle(), 800)
  onCleanup(() => {
    scheduleSave.flush()
    scheduleTitle.flush()
    document?.draft.flushRecovery()
    document?.release()
    disposed = true
    selectionRevision++
    titleField = undefined
  })

  // Land the pane: retained notes:open intent wins, then the remembered note, else the scratchpad.
  createEffect(() => {
    if (!api || taskList.loading || landed()) return
    setLanded(true)
    const intent = consumePaneIntent(taskId, 'notes')
    if (intent && intent.kind === 'notes:open' && (intent.scope !== 'workspace' || wsId())) return void open(intent.scope, intent.slug)
    const remembered = notesSelectionFor(taskId, nodeId)
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

  function flush() {
    scheduleSave.flush()
    scheduleTitle.flush()
    document?.draft.flushRecovery()
  }

  function landScratchpad() {
    flush()
    selectionRevision++
    setPreview(false)
    const existing = scratchpad()
    if (existing) return void open('task', existing.slug)
    const location: NoteLocation = { scope: 'task', taskId }
    const draft = noteDraft(nodeId, location, SCRATCHPAD_SLUG)
    adoptDocument({ location, slug: SCRATCHPAD_SLUG, draft, virtual: true })
    setSelected({ scope: 'task', slug: SCRATCHPAD_SLUG, virtual: true })
    setNoteTitle(draft.title ?? 'Scratchpad')
    setBody(draft.body ?? '')
    setActionError(draft.error)
  }

  // Creation belongs to the virtual document, even if the view retires before it answers. Transfer
  // its recovery edits and save them on that Node; only the still-current view may adopt the slug.
  function ensureScratchpad(): Promise<void> {
    if (scratchCreate) return scratchCreate
    const original = document
    if (!original?.virtual) return Promise.resolve()
    const ticket = selectionRevision
    scratchCreate = (async () => {
      try {
        const existing = scratchpad()
        const result = existing ? { slug: existing.slug } : await api.create(original.location, 'Scratchpad', 'scratch')
        if ('error' in result) throw new Error(result.error)
        const draft = noteDraft(nodeId, original.location, result.slug)
        if (original.draft.body !== undefined) draft.edit('body', original.draft.body)
        if (original.draft.title !== undefined) draft.edit('title', original.draft.title)
        draft.flushRecovery()
        if (draft !== original.draft) original.draft.discard()
        if (live() && ticket === selectionRevision) {
          adoptDocument({ location: original.location, slug: result.slug, draft })
          setSelected({ scope: 'task', slug: result.slug })
          rememberNotesSelection(taskId, { scope: 'task', slug: result.slug }, nodeId)
          void refetchTask()
        }
        const error = await draft.save(api)
        if (live() && ticket === selectionRevision) setActionError(error)
      } catch (error) {
        original.draft.fail(error instanceof Error ? error.message : String(error))
        if (live() && ticket === selectionRevision) setActionError(error instanceof Error ? error.message : String(error))
        scratchCreate = null
      }
    })()
    return scratchCreate
  }

  async function open(scope: NoteScope, slug: string) {
    const location = locationFor(scope)
    if (!live() || !location) return
    flush()
    const ticket = ++selectionRevision
    try {
      const result = await api.read(location, slug)
      if (!live() || ticket !== selectionRevision) return
      if ('error' in result) return setActionError(result.error)
      flush() // Edits made while this read was held still belong to the outgoing document.
      const draft = noteDraft(nodeId, location, slug)
      adoptDocument({ location, slug, draft })
      setActionError(draft.error)
      setPreview(false)
      setSelected({ scope, slug })
      setBody(draft.body ?? result.body)
      setNoteTitle(draft.title ?? result.title)
      setSaving(false)
      rememberNotesSelection(taskId, { scope, slug }, nodeId)
    } catch (error) {
      if (live() && ticket === selectionRevision) setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function save(notify = true) {
    const target = document
    if (!target) return
    if (target.virtual) return ensureScratchpad()
    const ticket = selectionRevision
    if (live()) setSaving(true)
    const error = await target.draft.save(api)
    if (!live() || ticket !== selectionRevision) return
    setSaving(false)
    setActionError(error)
    if (notify && !error && !target.draft.dirty) toast('Note saved', { tone: 'success' })
  }

  async function saveTitle() {
    const ticket = selectionRevision
    const scope = selected()?.scope
    await save(false)
    if (live() && ticket === selectionRevision && scope) await refetchScope(scope)
  }

  async function createIn(scope: NoteScope): Promise<boolean> {
    const location = locationFor(scope)
    if (!live() || !location) return false
    flush()
    const ticket = ++selectionRevision
    try {
      const result = await api.create(location, 'Untitled')
      if (!live() || ticket !== selectionRevision) return false
      if ('error' in result) { setActionError(result.error); return false }
      await refetchScope(scope)
      if (!live() || ticket !== selectionRevision) return false
      const opening = selectionRevision + 1
      await open(scope, result.slug)
      return live() && selectionRevision === opening && selected()?.scope === scope && selected()?.slug === result.slug
    } catch (error) {
      if (live() && ticket === selectionRevision) setActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  async function toggleIncluded(scope: NoteScope, slug: string, included: boolean) {
    const location = locationFor(scope)
    if (!live() || !location) return
    const ticket = selectionRevision
    try {
      const result = await (document?.slug === slug && selected()?.scope === scope ? document.draft : noteDraft(nodeId, location, slug)).run(() => api.setIncluded(location, slug, included))
      if (!live() || ticket !== selectionRevision) return
      if ('error' in result) return setActionError(result.error)
      setActionError('')
      await refetchScope(scope)
    } catch (error) {
      if (live() && ticket === selectionRevision) setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function remove(scope: NoteScope, slug: string) {
    const location = locationFor(scope)
    if (!live() || !location) return
    flush()
    const ticket = ++selectionRevision
    const draft = document?.slug === slug && selected()?.scope === scope ? document.draft : noteDraft(nodeId, location, slug)
    try {
      const result = await draft.run(() => api.remove(location, slug))
      if ('error' in result) throw new Error(result.error)
      draft.discard()
      if (!live() || ticket !== selectionRevision) return
      setActionError('')
      await refetchScope(scope)
      if (live() && ticket === selectionRevision && isActive(scope, slug)) landScratchpad()
    } catch (error) {
      if (live() && ticket === selectionRevision) setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  function onBodyInput(value: string) {
    if (!live()) return
    setBody(value)
    document?.draft.edit('body', value)
    if (document?.virtual) void ensureScratchpad()
    else scheduleSave()
  }

  function onTitleInput(value: string) {
    if (!live()) return
    setNoteTitle(value)
    document?.draft.edit('title', value)
    if (document?.virtual) void ensureScratchpad()
    else scheduleTitle()
  }

  return {
    taskId,
    // The title field's element, held by the model rather than by the list, because the two are in
    // different regions the host mounts independently: the "+" that creates a note is in the list and
    // the field it wants focused is in the detail.
    titleRef: (element: HTMLInputElement) => { titleField = element },
    requestTitleFocus: () => {
      const ticket = selectionRevision
      queueMicrotask(() => { if (live() && ticket === selectionRevision) { titleField?.focus(); titleField?.select() } })
    },
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
