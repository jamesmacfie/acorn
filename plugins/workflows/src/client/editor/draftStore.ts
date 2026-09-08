// The editor's state around one open definition: the draft, its history, what the node says about it,
// and the four writes (docs/workflows.md § Authoring).
//
// The rules are next door and pure (./draft.ts). What is here is everything reactive: the load, the
// catalog and provider reads the inspector draws from, the debounced validate, the dirty flag, and the
// saves with their revision handling.
import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from 'solid-js'
import { debounce } from '@acorn/plugin-api/client'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { workflowApi } from '../workflowsClient'
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

/** Which store a definition came from, and its id there. The URL carries the pair as one string so a
 *  link is a link (docs/workflows.md § Authoring). */
export type DefRef = { source: 'database' | 'repo' | 'user'; id: string }

export const defRefKey = (ref: DefRef): string => `${ref.source === 'database' ? 'db' : ref.source}:${ref.id}`

/** A key arrives either from the address, where it is encoded, or straight from `defRefKey`, where it
 *  is not. A malformed escape is not worth throwing over: the caller reads it as unparseable. */
const decodeItem = (item: string): string => {
  try {
    return decodeURIComponent(item)
  } catch {
    return item
  }
}

export function parseDefRef(item: string | undefined): DefRef | null {
  if (!item) return null
  // Decoded here, because Solid Router hands a path parameter back exactly as it sits in the address
  // and `workflowsSurfacePath` encodes the separator. Reading `db%3Aabc` as a definition nobody can
  // name is how the whole editor once opened read-only.
  const match = /^(db|repo|user):(.+)$/.exec(decodeItem(item))
  if (!match) return null
  return { source: match[1] === 'db' ? 'database' : (match[1] as 'repo' | 'user'), id: match[2] }
}

/** What the node is asked for, for a `repo:` or `user:` file. The row id it is stored under is the
 *  same string the URL carries minus the `db:` prefix. */
const routeId = (ref: DefRef): string => (ref.source === 'database' ? ref.id : `${ref.source}:${ref.id}`)

/** How long typing coalesces into one undo step. Long enough that a word is one undo and short enough
 *  that a pause makes a boundary. */
const UNDO_COALESCE_MS = 600
const VALIDATE_DELAY_MS = 400

export type WorkflowDraftStore = ReturnType<typeof createDraftStore>

export function createDraftStore(input: { projectId: () => string; item: () => string | undefined }) {
  const ref = createMemo<DefRef | null>(() => parseDefRef(input.item()))
  const readOnly = () => ref()?.source !== 'database'
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

  // Loaded through a resource keyed on the addressed definition, so navigating between two of them in
  // the list is a refetch rather than a remount of the whole surface.
  const [loaded] = createResource(
    () => {
      const current = ref()
      return current ? { key: defRefKey(current), route: routeId(current), projectId: input.projectId() } : null
    },
    async (query) => workflowApi.def(query.route, query.projectId || undefined),
  )

  createEffect(on(loaded, (row) => {
    if (!row) return
    const def = row.def as WorkflowDef
    setDraftRaw(newDraft(def))
    setPast([])
    setFuture([])
    setRevision(row.revision)
    setSaved(toJson(def))
    setMessage(undefined)
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
    setDraftRaw(stack[stack.length - 1])
    setPast(stack.slice(0, -1))
    lastPush = 0
  }

  const redo = (): void => {
    const stack = future()
    if (!stack.length) return
    setPast((back) => pushUndo(back, draft()))
    setDraftRaw(stack[stack.length - 1])
    setFuture(stack.slice(0, -1))
    lastPush = 0
  }

  /** A rename carries the node's canvas position with it, or the layout would name a node that is
   *  gone (../layoutPrefs.ts). */
  const rename = (from: string, to: string): void => {
    apply((current) => renameNode(current, from, to))
    const current = ref()
    if (current) renameInLayout(defRefKey(current), from, to)
  }

  const [problems, setProblems] = createSignal<string[]>([])
  const validate = debounce((def: WorkflowDef, projectId: string) => {
    void workflowApi
      .validateDef(def, projectId || undefined)
      .then((answer) => setProblems(answer.problems))
      // A node that cannot answer is not a definition that is wrong. The footer keeps its last word.
      .catch(() => undefined)
  }, VALIDATE_DELAY_MS)
  // A memo, not an inline getter: `on` fires on identity, and the draft is a new object per keystroke
  // (docs/frontend.md § Reactivity). The JSON is what actually changed.
  const defJson = createMemo(() => toJson(draft().def))
  createEffect(on(defJson, () => validate(draft().def, input.projectId())))
  onCleanup(() => validate.cancel())

  const [catalog] = createResource(() => input.projectId() || 'none', async (projectId) =>
    workflowApi.catalog(projectId === 'none' ? undefined : projectId))
  const [providers] = createResource(async () => workflowApi.providers().catch(() => []))

  const guard = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setMessage(undefined)
    try {
      return await work()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That did not work.')
      return undefined
    } finally {
      setBusy(false)
    }
  }

  /** Save the row at the revision it was read at. A 409 means somebody else's save landed first: the
   *  draft is kept and the reader is told, because throwing away what they typed to show them what
   *  changed is the wrong half to lose. */
  const save = async (): Promise<boolean> => {
    const current = ref()
    if (!current || current.source !== 'database') return false
    const def = draft().def
    const row = await guard(() => workflowApi.updateDef(current.id, def, revision()))
    if (!row) {
      setMessage((text) => text ?? 'That save did not land.')
      return false
    }
    setRevision(row.revision)
    setSaved(toJson(def))
    return true
  }

  const saveToRepo = async (options: { taskId?: string; keepRow: boolean }): Promise<string | undefined> => {
    const current = ref()
    if (!current || current.source !== 'database') return undefined
    const answer = await guard(() => workflowApi.saveDefToRepo(current.id, options))
    if (answer && !options.keepRow) forgetLayout(defRefKey(current))
    return answer?.path
  }

  /** A committed file, as a row of the reader's own. The one write a read-only definition offers. */
  const copyToDatabase = async (workspaceId: string): Promise<string | undefined> => {
    const projectId = input.projectId()
    const row = await guard(() => workflowApi.createDef({
      workspaceId,
      ...(projectId ? { projectId } : {}),
      def: { ...draft().def, name: `${draft().def.name} (copy)` },
    }))
    return row?.id
  }

  const remove = async (): Promise<boolean> => {
    const current = ref()
    if (!current || current.source !== 'database') return false
    const answer = await guard(() => workflowApi.deleteDef(current.id))
    if (answer?.ok) forgetLayout(defRefKey(current))
    return !!answer?.ok
  }

  /** The JSON tab's Apply. Atomic: an invalid document changes nothing and comes back as a message. */
  const applyText = (text: string): string | undefined => {
    const answer = applyJson(draft(), text)
    if ('error' in answer) return answer.error
    apply(() => answer.draft)
    return undefined
  }

  return {
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
