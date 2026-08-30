// Everything the API panel knows, held once per subject and read by both of its regions.
//
// The pane is a `list-detail` layout, so the request tree and the request being edited are two
// entries in this bundle that the host mounts side by side (docs/panes.md § Layout model). They share
// the selection, the draft, the send result and the saved lists, and the shared thing has to outlive
// either of them.
//
// A compiled plugin's regions are components in the shell's realm and get this from the host, as a
// `model` on the pane contribution (client-core registries/paneModels.ts). A loaded plugin needs no
// such seam, and this file is why: both regions are entries in one bundle running in one worker, so
// module scope already is the shared thing. That is the whole of the loaded half — one `createRoot`
// keyed by the subject the host mounted.
//
// Keyed by project and task, because those are the two things that change what is on screen. One at a
// time: the reader is looking at one panel, and a worker has no scope-eviction channel to hear about
// anything else, so the previous one is disposed when the next asks.
import { createEffect, createMemo, createResource, createRoot, createSignal, onCleanup } from 'solid-js'
import { createArmedConfirm } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { fromCurl, toCurl, type HttpRequest, type SendResult } from '../shared/model'
import { createRequest, deleteRequest, listRequests, sendRequest, updateRequest } from './httpClient'
import { draftsDiffer, emptyDraft, toDraft, toSendInput, type Draft } from './draft'
import type { SaveTarget } from './SaveRequestModal'

export type Selection = { kind: 'saved'; id: string } | { kind: 'new' } | { kind: 'variables' }

// Requests carry a slash path ('auth/login'), not a folder id: grouping is a client-side split.
// A folder therefore exists exactly as long as something is filed in it.
export type Group = { folder: string; requests: HttpRequest[] }

export function groupByFolder(requests: HttpRequest[]): Group[] {
  const byFolder = new Map<string, HttpRequest[]>()
  for (const r of requests) {
    const list = byFolder.get(r.folder) ?? []
    list.push(r)
    byFolder.set(r.folder, list)
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({ folder, requests: list.sort((a, b) => a.name.localeCompare(b.name)) }))
}

export type PanelSubject = {
  bridge: AcornBridge
  projectId: string
  projectName: string
  taskId?: string
  /** The rail row this surface was opened on, when it was opened by one. A later row click into the
   *  same mounted tree arrives as `bridge.onSelect` instead. */
  initialRequestId?: string
}

export type HttpPanelModel = ReturnType<typeof build>

const subjectKey = (subject: PanelSubject): string => `${subject.projectId}|${subject.taskId ?? ''}`

let held: { key: string; model: HttpPanelModel; dispose: () => void } | null = null

export function httpPanelModel(subject: PanelSubject): HttpPanelModel {
  const key = subjectKey(subject)
  if (held?.key === key) return held.model
  held?.dispose()
  held = createRoot((dispose) => ({ key, model: build(subject), dispose }))
  return held.model
}

/** Test seam, and the only way to drop the held model: a worker has no eviction event. */
export const _resetHttpPanelModel = (): void => {
  held?.dispose()
  held = null
}

function build(subject: PanelSubject) {
  const { bridge, projectId, projectName, taskId } = subject
  const blank = () => emptyDraft(taskId ?? null)
  const [selection, setSelection] = createSignal<Selection>({ kind: 'new' })
  const [draft, setDraft] = createSignal<Draft>(blank())
  const [result, setResult] = createSignal<SendResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveOpen, setSaveOpen] = createSignal(false)

  // The repo tree. A task pane also lists that task's ad-hoc requests, in their own group above it.
  const [saved, savedActions] = createResource(() => listRequests(projectId))
  const [adhoc, adhocActions] = createResource(() => (taskId ? listRequests(projectId, taskId) : Promise.resolve([])))

  const refresh = () => {
    void savedActions.refetch()
    void adhocActions.refetch()
  }

  const armedDelete = createArmedConfirm()

  const current = createMemo<HttpRequest | null>(() => {
    const sel = selection()
    if (sel.kind !== 'saved') return null
    return [...(saved() ?? []), ...(adhoc() ?? [])].find((r) => r.id === sel.id) ?? null
  })

  const dirty = createMemo(() => {
    const row = current()
    return row ? draftsDiffer(draft(), toDraft(row)) : draft().url !== ''
  })

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  function open(row: HttpRequest) {
    armedDelete.disarm()
    setSelection({ kind: 'saved', id: row.id })
    setDraft(toDraft(row))
    setResult(null)
    setError(null)
  }

  // A rail selection names a request id; the row itself arrives with the list. An effect rather than
  // mount-time work, because the id can land before the list or after it.
  //
  // Subscribed once, here, rather than in a region: one worker serves both regions and so holds one
  // bridge, and two subscriptions would open the same request twice.
  const [requested, setRequested] = createSignal<string | undefined>(subject.initialRequestId)
  onCleanup(bridge.onSelect((item) => setRequested(item)))
  createEffect(() => {
    const id = requested()
    if (!id) return
    const row = [...(saved() ?? []), ...(adhoc() ?? [])].find((candidate) => candidate.id === id)
    if (!row) return
    setRequested(undefined)
    open(row)
  })

  function startNew(from?: HttpRequest) {
    setSelection({ kind: 'new' })
    // "Copy an existing request": the same flow as starting from scratch, just pre-filled. An
    // ad-hoc copy belongs to the task, so it drops the folder it came from.
    setDraft(from ? { ...toDraft(from), name: `${from.name} copy`, taskId: taskId ?? null, folder: taskId ? '' : from.folder } : blank())
    setResult(null)
    setError(null)
  }

  const folders = createMemo(() => [...new Set((saved() ?? []).map((r) => r.folder).filter(Boolean))].sort())
  const groups = createMemo(() => groupByFolder(saved() ?? []))

  const saveTarget = createMemo<SaveTarget>(() => ({
    name: draft().name,
    folder: draft().folder,
    scope: draft().taskId ? 'task' : 'project',
  }))

  // `error` is shared with the send path, and the dialog shows it. Don't open onto a stale one.
  const openSave = () => {
    setError(null)
    setSaveOpen(true)
  }

  // Saving an existing request writes straight through: its name and home are already settled.
  // Anything else (a new request, or a rename/move via the name button) asks first.
  const onSaveClick = () => (current() ? void persist(draft()) : openSave())

  async function persist(d: Draft) {
    if (!d.name.trim()) return setError('Give the request a name before saving.')
    setSaving(true)
    setError(null)
    try {
      const row = current()
      const next = row ? await updateRequest(projectId, row.id, d) : await createRequest(projectId, d)
      setSelection({ kind: 'saved', id: next.id })
      setDraft(toDraft(next))
      setSaveOpen(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the request')
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: HttpRequest) {
    if (!armedDelete.request(row.id)) return
    try {
      await deleteRequest(projectId, row.id)
      if (current()?.id === row.id) startNew()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the request')
    }
  }

  async function fire() {
    if (!draft().url.trim()) return setError('Enter a URL first.')
    setSending(true)
    setError(null)
    setResult(null)
    try {
      // The panel decides where commands run (docs/http-client.md § Data model).
      setResult(await sendRequest(projectId, toSendInput(draft(), taskId ?? null)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }

  /**
   * The URL bar committed. A curl command pasted in expands into the whole request, as Bruno does.
   *
   * On commit rather than on paste, and that is the one visible difference the move to a tree cost
   * here: a paste event is a DOM event, so it cannot cross to a sandbox that has no DOM. Pressing
   * Enter or leaving the field does the expansion instead, which is one keystroke later and the same
   * result (docs/http-client.md § Client).
   */
  function commitUrl(value: string): boolean {
    if (/^\s*curl\s/i.test(value)) {
      const parsed = fromCurl(value)
      if (parsed) {
        patch({ method: parsed.method, url: parsed.url, headers: parsed.headers, bodyMode: parsed.bodyMode, body: parsed.body, auth: parsed.auth })
        return true
      }
    }
    patch({ url: value })
    return false
  }

  // Through the bridge, not `navigator.clipboard` (docs/http-client.md § Client).
  const copy = (text: string) => void bridge.ui.copy(text)
  const copyAsCurl = () => copy(toCurl(draft()))

  return {
    projectId,
    projectName,
    taskId,
    selection, setSelection,
    draft, patch, setDraft,
    result, error, setError,
    sending, saving,
    saveOpen, setSaveOpen, openSave, onSaveClick, saveTarget, persist,
    saved, adhoc, groups, folders,
    armedDelete,
    current, dirty,
    open, startNew, remove, fire,
    commitUrl, copy, copyAsCurl,
  }
}
