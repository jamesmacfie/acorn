// The editor's state around one open definition: the draft, its history, what the node says about it,
// and the four writes (docs/workflows/authoring.md § Authoring).
//
// The rules are next door and pure (./draft.ts). What is here is everything reactive: the load, the
// catalog and provider reads the inspector draws from, the debounced validate, the dirty flag, and the
// saves with their revision handling.
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, untrack } from 'solid-js'
import { useQueryClient, type QueryClient } from '@tanstack/solid-query'
import { defRefKey, parseDefRef, workflowDraftAddress, type DefRef, type WorkflowDraftAddress as Address } from './draftAddress'
export { defRefKey, parseDefRef, SOURCE_GLYPH, type DefRef } from './draftAddress'
import { workflowDraftCustody } from './draftCustody'
import { activeNodeId, queryOwner, debounce, deviceStorage, wsOnPluginsChanged } from '@acorn/plugin-api/client'
import { mergeWorkflow, type WorkflowMergeConflict } from '../../shared/workflowMerge'
import type { WorkflowPublication } from '../../shared/workflowPublication'
import type { WorkflowFileOperation } from '../../shared/workflowFileAuthoring'
import { workflowRecoveryStore, WORKFLOW_AUTOSAVE_MS } from './recoveryStore'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { createWorkflowApi } from '../workflowsClient'
import { forgetLayout, renameInLayout } from '../layoutPrefs'
import {
  applyJson,
  emptyDefinition,
  newDraft,
  pushUndo,
  renameNode,
  toJson,
  type WorkflowDraft,
} from './draft'

/** Where the draft stands against the node. One badge draws it: "Saving…" covers the autosave gap as
 *  well as the write itself, because a word that changes during every pause in typing reads as a
 *  different state. "unsaved" means the last write failed; the device copy is what keeps the work. */
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'conflict'

/** How long typing coalesces into one undo step. Long enough that a word is one undo and short enough
 *  that a pause makes a boundary. */
const UNDO_COALESCE_MS = 600
const VALIDATE_DELAY_MS = 400

export type WorkflowDraftStore = ReturnType<typeof createDraftStore>

export function createDraftStore(input: { projectId: () => string; item: () => string | undefined; queryClient?: QueryClient }) {
  const queryClient = input.queryClient ?? useQueryClient()
  const registered = queryOwner(queryClient)
  const nodeId = registered === undefined ? activeNodeId() : registered
  const workflowApi = createWorkflowApi(queryClient)
  let disposed = false
  const ref = createMemo<DefRef | null>(() => parseDefRef(input.item()))
  const readOnly = () => !ref() || loaded.loading || !!loaded.error
  // Told apart from `readOnly`, because "this is committed, copy it" and "this address names nothing"
  // are different things to say and the second one used to wear the first one's words.
  const unreadable = () => !!input.item() && !ref()

  const [draft, setDraftRaw] = createSignal<WorkflowDraft>(newDraft(emptyDefinition()))
  const [past, setPast] = createSignal<WorkflowDraft[]>([])
  const [future, setFuture] = createSignal<WorkflowDraft[]>([])
  const [saved, setSaved] = createSignal<string>('')
  const [revision, setRevision] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<string | undefined>()
  const recovery = workflowRecoveryStore(deviceStorage())
  const [saveState, setSaveState] = createSignal<SaveState>('saved')
  const [publishedRevision, setPublishedRevision] = createSignal<number | null>(null)
  const [publishedDef, setPublishedDef] = createSignal<WorkflowDef | undefined>()
  const [publication, setPublication] = createSignal<WorkflowPublication | undefined>()
  const [fileOperation, setFileOperation] = createSignal<WorkflowFileOperation>()
  const [fileConflicts, setFileConflicts] = createSignal<WorkflowMergeConflict[]>([])
  let fileChoices: Record<string, 'local' | 'external'> = {}
  let externalHash: string | undefined
  const [conflicts, setConflicts] = createSignal<WorkflowMergeConflict[]>([])
  let mergeBase: { base: WorkflowDef; local: WorkflowDef; external: WorkflowDef; choices: Record<string, 'local' | 'external'> } | undefined
  let baseDef = emptyDefinition()
  let generation = 0
  const entities = new Map<string, ReturnType<typeof workflowDraftCustody>>()
  let owner: { address: Address; custody: ReturnType<typeof workflowDraftCustody> } | undefined
  const isCurrent = (address: Address) => !disposed && owner?.address === address && address.generation === generation && (nodeId === null || activeNodeId() === nodeId)
  const capture = () => {
    loaded()
    return !loaded.loading && owner && isCurrent(owner.address) ? owner.address : undefined
  }
  const current = (address: Address | undefined) => !!address && isCurrent(address)

  // Loaded through a resource keyed on the addressed definition, so navigating between two of them in
  // the list is a refetch rather than a remount of the whole surface.
  const [loaded] = createResource(
    () => {
      const current = ref()
      if (owner?.custody.dirty() && !owner.custody.state.conflicts.length) untrack(() => { void owner!.custody.save() })
      for (const [id, custody] of entities) { if (!custody.busy && !custody.dirty()) entities.delete(id) }
      generation += 1
      if (!current) return null
      const projectId = input.projectId()
      return workflowDraftAddress(current, projectId, generation)
    },
    async (query: Address) => {
      const row = query.source === 'database'
        ? await workflowApi.def(query.route, query.projectId || undefined)
        : await workflowApi.files({ action: 'open', target: query.target }).then(result => {
          const value = result.draft!
          return { id: query.entityId, workspaceId: '', projectId: query.projectId, name: value.def.name,
            revision: value.revision, createdAt: 0, updatedAt: 0, def: value.def,
            publishedRevision: null, publishedDef: undefined }
        })
      return { ...row, address: query }
    },
  )

  createEffect(on(loaded, (row) => {
    if (!row || disposed || row.address.generation !== generation || (nodeId !== null && activeNodeId() !== nodeId)) return
    const address = row.address
    const def = row.def as WorkflowDef
    const retained = entities.get(address.entityId)
    const custody = retained ?? workflowDraftCustody({ nodeId: nodeId ?? '', entityId: address.entityId,
      initial: { revision: row.revision, def }, recovery,
      write: async (def, revision) => address.source === 'database'
        ? workflowApi.updateDef(address.route, def, revision).then(row => ({ revision: row.revision, def: row.def as WorkflowDef }))
        : workflowApi.files({ action: 'save', target: address.target, def, revision }).then(result => result.draft!),
      read: async () => address.source === 'database'
        ? workflowApi.def(address.route, address.projectId || undefined).then(row => ({ revision: row.revision, def: row.def as WorkflowDef }))
        : workflowApi.files({ action: 'open', target: address.target }).then(result => result.draft!),
      changed: () => {
        if (owner?.custody !== custody || !isCurrent(owner.address)) return
        const state = custody.state
        setRevision(state.revision)
        baseDef = state.base
        setSaved(toJson(state.base))
        setSaveState(state.status)
        setBusy(custody.busy)
        setMessage(state.message)
        setConflicts(state.conflicts)
        mergeBase = state.merge
        if (draft().def !== state.local) setDraftRaw(newDraft(state.local))
      },
    })
    entities.set(address.entityId, custody)
    owner = { address, custody }
    setBusy(custody.busy)
    setSaveState(custody.state.status)
    setPublication(undefined)
    mergeBase = undefined
    lastPush = 0
    setDraftRaw(newDraft(custody.state.local))
    setPast([])
    setFuture([])
    setRevision(custody.state.revision)
    setPublishedRevision(row.publishedRevision ?? null)
    setPublishedDef(row.publishedDef as WorkflowDef | undefined)
    baseDef = custody.state.base
    setSaved(toJson(baseDef))
    setMessage(custody.state.message)
    setConflicts(custody.state.conflicts)
    mergeBase = custody.state.merge
    setFileConflicts([])
    setFileOperation(undefined)
    fileChoices = {}
    externalHash = undefined
    if (address.projectId) void workflowApi.files({ action: 'list', projectId: address.projectId }).then(result => {
      if (!isCurrent(address)) return
      setFileOperation(result.operations?.find(operation => operation.state !== 'complete' && (address.source === 'database' ? operation.rootId === address.route : operation.source === address.source && operation.rootPath === address.target.path)))
    }).catch(() => undefined)
    const copy = recovery.latest(nodeId ?? '', address.entityId)
    if (copy && !retained) {
      mergeBase = { base: copy.base, local: copy.local, external: def, choices: {} }
      const merged = mergeWorkflow(copy.base, copy.local, def)
      setConflicts(merged.conflicts)
      custody.state.merge = mergeBase
      custody.state.conflicts = merged.conflicts
      custody.edit(merged.value)
      setDraftRaw(newDraft(merged.value))
      setSaveState(merged.conflicts.length ? 'conflict' : dirty() ? 'saving' : 'saved')
    }
    if (row.workspaceId && workflowApi.publications) void workflowApi.publications(row.workspaceId).then(operations => {
      if (!isCurrent(address)) return
      setPublication(operations.find(operation => operation.rootId === row.id && operation.state !== 'complete'))
    }).catch(() => undefined)
  }))

  const dirty = () => toJson(draft().def) !== saved()

  // One undo entry per burst. `at` is the last push, not the last edit, so holding a key for two
  // seconds still leaves two steps behind rather than one.
  let lastPush = 0
  /** Change the draft. `coalesce` folds a keystroke into the previous history entry. */
  const apply = (change: (current: WorkflowDraft) => WorkflowDraft, options: { coalesce?: boolean } = {}): void => {
    const current = draft()
    const next = change(current)
    if (next === current) return
    const now = Date.now()
    if (!options.coalesce || now - lastPush > UNDO_COALESCE_MS) {
      setPast((stack) => pushUndo(stack, current))
      lastPush = now
    }
    setFuture([])
    if (owner && isCurrent(owner.address)) owner.custody.edit(next.def)
    setDraftRaw(next)
  }

  /** Selection alone: it moves no data, so it is not an undo step. */
  const select = (change: (current: WorkflowDraft) => WorkflowDraft): void => {
    setDraftRaw(change(draft()))
  }

  const undo = (): void => {
    const stack = past()
    if (!stack.length) return
    setFuture((forward) => pushUndo(forward, draft()))
    if (owner && isCurrent(owner.address)) owner.custody.edit(stack[stack.length - 1].def)
    setDraftRaw(stack[stack.length - 1])
    setPast(stack.slice(0, -1))
    lastPush = 0
  }

  const redo = (): void => {
    const stack = future()
    if (!stack.length) return
    setPast((back) => pushUndo(back, draft()))
    if (owner && isCurrent(owner.address)) owner.custody.edit(stack[stack.length - 1].def)
    setDraftRaw(stack[stack.length - 1])
    setFuture(stack.slice(0, -1))
    lastPush = 0
  }

  /** A rename carries the node's canvas position with it, or the layout would name a node that is
   *  gone (../layoutPrefs.ts). */
  const rename = (from: string, to: string): void => {
    apply((current) => renameNode(current, from, to))
    const current = ref()
    if (current && draft().def.formatVersion !== 1) renameInLayout(defRefKey(current), from, to)
  }

  const [problems, setProblems] = createSignal<string[]>([])
  let validation = 0
  const validate = debounce((def: WorkflowDef, projectId: string, address: Address | undefined) => {
    const request = ++validation
    void workflowApi
      .validateDef(def, projectId || undefined)
      .then((answer) => { if (current(address) && request === validation && toJson(draft().def) === toJson(def)) setProblems(answer.problems) })
      // A node that cannot answer is not a definition that is wrong. The footer keeps its last word.
      .catch(() => undefined)
  }, VALIDATE_DELAY_MS)
  // A memo, not an inline getter: `on` fires on identity, and the draft is a new object per keystroke
  // (docs/frontend.md § Reactivity). The JSON is what actually changed.
  const defJson = createMemo(() => toJson(draft().def))
  createEffect(on(defJson, () => validate(draft().def, input.projectId(), capture())))
  onCleanup(() => validate.cancel())

  const [catalog, { refetch: refetchCatalog }] = createResource(() => input.projectId() || 'none', async (projectId) =>
    workflowApi.catalog(projectId === 'none' ? undefined : projectId))
  onCleanup(wsOnPluginsChanged(() => {
    const address = capture()
    if (!address) return
    void Promise.resolve(refetchCatalog()).then(() => {
      if (current(address)) validate(draft().def, address.projectId, address)
    }).catch(() => undefined)
  }))
  const [providers] = createResource(async () => workflowApi.providers().catch(() => []))

  const guard = async <T>(work: () => Promise<T>, address = capture()): Promise<T | undefined> => {
    setBusy(true)
    setMessage(undefined)
    try {
      return await work()
    } catch (error) {
      if (current(address)) setMessage(error instanceof Error ? error.message : 'That did not work.')
      return undefined
    } finally {
      if (current(address)) {
        setBusy(owner?.custody.busy ?? false)
        if (dirty() && !conflicts().length) autosave()
      }
    }
  }

  /** Save the row at the revision it was read at. A 409 means somebody else's save landed first: the
   *  draft is kept and the reader is told, because throwing away what they typed to show them what
   *  changed is the wrong half to lose. */
  const save = (): Promise<boolean> => {
    if (!owner || !isCurrent(owner.address) || fileConflicts().length) return Promise.resolve(false)
    if (busy() && !owner.custody.busy) return Promise.resolve(false)
    owner.custody.edit(draft().def)
    return owner.custody.save()
  }
  const autosave = debounce(() => { if (dirty() && !conflicts().length) void save() }, WORKFLOW_AUTOSAVE_MS)
  createEffect(on(defJson, () => {
    if (!owner || !isCurrent(owner.address) || readOnly() || !revision()) return
    owner.custody.edit(draft().def)
    if (!dirty() || conflicts().length) return
    setSaveState('saving')
    autosave()
  }))
  onCleanup(() => {
    autosave.cancel()
    if (owner?.custody.dirty() && !owner.custody.state.conflicts.length) void owner.custody.save()
    disposed = true
  })
  const resolveConflict = (path: string, choice: 'local' | 'external') => {
    if (!mergeBase) return
    mergeBase.choices[path] = choice
    const merged = mergeWorkflow(mergeBase.base, mergeBase.local, mergeBase.external, mergeBase.choices)
    apply(() => newDraft(merged.value))
    setConflicts(merged.conflicts)
    if (owner) { owner.custody.state.conflicts = merged.conflicts; owner.custody.edit(merged.value) }
    if (!merged.conflicts.length) autosave()
  }
  const preparePublication = async () => {
    const address = capture()
    const current = ref()
    const submitted = draft().def
    if (!address || !current) return
    if ((dirty() || owner?.custody.busy) && !(await save())) return
    if (!isCurrent(address)) return
    if (toJson(baseDef) !== toJson(submitted)) return
    if (current.source !== 'database') {
      const result = await guard(() => workflowApi.files({ action: 'review', target: address.target, revision: revision(), choices: fileChoices, externalHash }))
      if (!isCurrent(address)) return
      externalHash = result?.externalHash
      if (!result) fileChoices = {}
      if (result?.draft && owner) {
        const local = draft().def
        baseDef = result.draft.def
        const merged = mergeWorkflow(submitted, local, baseDef)
        setRevision(result.draft.revision)
        setDraftRaw(newDraft(merged.value))
        setSaved(toJson(baseDef))
        owner.custody.state.revision = result.draft.revision
        owner.custody.state.base = baseDef
        owner.custody.state.conflicts = merged.conflicts
        mergeBase = { base: submitted, local, external: baseDef, choices: {} }
        owner.custody.state.merge = mergeBase
        owner.custody.edit(merged.value)
        setConflicts(merged.conflicts)
        setSaveState(merged.conflicts.length ? 'conflict' : dirty() ? 'saving' : 'saved')
      }
      setFileConflicts(result?.conflicts ?? [])
      if (result?.operation) { setFileOperation(result.operation); fileChoices = {} }
      return
    }
    const result = await guard(() => workflowApi.preparePublication({ id: current.id, revision: revision() }))
    if (isCurrent(address) && result) setPublication(result)
  }
  const resolveFileConflict = (path: string, choice: 'local' | 'external') => {
    fileChoices[path] = choice
    void preparePublication()
  }
  const publishFiles = async () => {
    const address = capture()
    if (!address) return
    const current = fileOperation()
    if (!current) return
    const result = await guard(() => workflowApi.files({ action: 'publish', id: current.id }))
    if (!isCurrent(address)) return
    if (result?.operation) setFileOperation(result.operation)
    if (result?.operation?.state === 'complete' && ref()?.source !== 'database') {
      const value = (await workflowApi.files({ action: 'open', target: address.target })).draft!
      if (!isCurrent(address)) return
      setRevision(value.revision)
      if (owner) owner.custody.state.revision = value.revision
      setMessage('Published to file. Working-tree changes remain uncommitted.')
    }
  }
  const prepareExport = async () => {
    const address = capture()
    if (!address) return
    if (address.source !== 'database' || !(await save()) || !isCurrent(address)) return
    const result = await guard(() => workflowApi.files({ action: 'export', projectId: address.projectId, id: address.route }))
    if (!isCurrent(address)) return
    if (result?.operation) setFileOperation(result.operation)
  }
  const discardFiles = async () => {
    const address = capture()
    if (!address) return
    const current = fileOperation()
    if (current && await guard(() => workflowApi.files({ action: 'discard', id: current.id })) && isCurrent(address)) setFileOperation(undefined)
  }
  const publish = async () => {
    const address = capture()
    if (!address) return
    const current = publication()
    if (!current) return
    const result = await guard(() => workflowApi.publish(current.id))
    if (!result || !isCurrent(address)) return
    setPublication(result)
    if (result.state === 'complete') {
      const landed = result.landed.find(write => write.kind === 'workflow' && write.id === ref()?.id)
      setPublishedRevision(landed?.revision ?? null)
      const write = result.writes.find(write => write.kind === 'workflow' && write.id === ref()?.id)
      if (write?.kind === 'workflow') setPublishedDef(write.def)
      // This editor instance survives navigation to a newly created child and back to its parent.
      // Refresh the shared target list now so the parent sees that child as published immediately.
      await refetchCatalog()
    }
  }
  const discardPublication = async () => {
    const address = capture()
    if (!address) return
    const current = publication()
    if (current && await guard(() => workflowApi.discardPublication(current.id)) && isCurrent(address)) setPublication(undefined)
  }

  const saveToRepo = async (options: { taskId?: string; keepRow: boolean }): Promise<string | undefined> => {
    const address = capture()
    if (!address) return
    const current = ref()
    if (!current || current.source !== 'database' || !(await save()) || !isCurrent(address)) return undefined
    const answer = await guard(() => workflowApi.saveDefToRepo(current.id, options))
    if (answer && !options.keepRow) forgetLayout(defRefKey(current))
    return isCurrent(address) ? answer?.path : undefined
  }

  /** A committed file, as a row of the reader's own. The one write a read-only definition offers. */
  const copyToDatabase = async (workspaceId: string): Promise<string | undefined> => {
    const address = capture()
    if (!address) return
    const projectId = address.projectId
    const row = await guard(() => workflowApi.createDef({
      workspaceId,
      ...(projectId ? { projectId } : {}),
      def: { ...draft().def, name: `${draft().def.name} (copy)` },
    }))
    return isCurrent(address) ? row?.id : undefined
  }

  const remove = async (): Promise<boolean> => {
    const address = capture()
    if (!address) return false
    const current = ref()
    if (!current || current.source !== 'database' || !(await save()) || !isCurrent(address)) return false
    const answer = await guard(() => workflowApi.deleteDef(current.id))
    if (answer?.ok) forgetLayout(defRefKey(current))
    return isCurrent(address) && !!answer?.ok
  }

  /** The JSON tab's Apply. Atomic: an invalid document changes nothing and comes back as a message. */
  const applyText = (text: string): string | undefined => {
    const answer = applyJson(draft(), text)
    if ('error' in answer) return answer.error
    apply(() => answer.draft)
    return undefined
  }

  return {
    api: workflowApi, capture, current,
    fileOperation, fileConflicts, resolveFileConflict, publishFiles, prepareExport, discardFiles,
    saveState, publishedRevision, publishedDef, publication, conflicts, resolveConflict, preparePublication, publish, discardPublication,
    ref,
    readOnly,
    unreadable,
    draft,
    apply,
    select,
    rename,
    undo,
    redo,
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    dirty,
    problems,
    catalog,
    refetchCatalog,
    providers,
    busy,
    message,
    setMessage,
    loading: () => loaded.loading,
    loadError: () => loaded.error as unknown,
    revision,
    save,
    saveToRepo,
    copyToDatabase,
    remove,
    applyText,
    json: defJson,
  }
}
