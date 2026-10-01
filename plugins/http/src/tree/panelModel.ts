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
// Equivalent host grants share live state. The latest inactive subject keeps its draft, without
// retaining bridges; per-region actions use that region's bridge and never borrow a sibling's lease.
import { createEffect, createMemo, createResource, createRoot, createSignal, getOwner, onCleanup } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { fromCurl, toCurl, type HttpRequest, type SendResult } from '../shared/model'
import { createHttpClient } from './httpClient'
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

const bridgeIds = new WeakMap<AcornBridge, number>()
let bridgeSequence = 0
const affinity = (bridge: AcornBridge): string => {
  if (bridge.context.authority) return bridge.context.authority
  let id = bridgeIds.get(bridge)
  if (id === undefined) { id = ++bridgeSequence; bridgeIds.set(bridge, id) }
  return `legacy-bridge:${id}`
}
const subjectKey = (subject: PanelSubject): string => JSON.stringify([affinity(subject.bridge), subject.projectId, subject.taskId ?? null])
type Held = { key: string; model: HttpPanelModel; views: WeakMap<AcornBridge, HttpPanelModel>; dispose(): void; bridges: Map<AcornBridge, { refs: number; detach: () => void }> }
const live = new Map<string, Held>()
let idle: Held | null = null

export function httpPanelModel(subject: PanelSubject): HttpPanelModel {
  const key = subjectKey(subject)
  let entry = live.get(key)
  const revived = !entry && idle?.key === key
  if (revived) { entry = idle!; idle = null }
  if (!entry) {
    idle?.dispose()
    idle = null
    const bridges: Held['bridges'] = new Map()
    bridges.set(subject.bridge, { refs: 0, detach: () => {} })
    const currentBridge = (): AcornBridge => {
      const current = bridges.keys().next().value as AcornBridge | undefined
      if (!current) throw new Error('this HTTP panel has no mounted bridge')
      return current
    }
    entry = createRoot((dispose) => {
      try {
        return { key, bridges, views: new WeakMap<AcornBridge, HttpPanelModel>(), model: build(subject, currentBridge, (bridge) => bridges.has(bridge)), dispose }
      } catch (error) {
        bridges.clear()
        dispose()
        throw error
      }
    })
  }
  live.set(key, entry)
  const owner = entry
  let lease = owner.bridges.get(subject.bridge)
  if (!lease || !lease.refs) {
    const unselect = subject.bridge.onSelect(owner.model.requestSelection)
    const unaction = subject.bridge.onSurfaceAction((command) => { if (command === 'new-request') owner.model.startNew() })
    lease = { refs: 0, detach: () => { unselect(); unaction() } }
    owner.bridges.set(subject.bridge, lease)
  }
  lease.refs++
  if (revived) owner.model.refresh()
  const bridge = subject.bridge
  if (getOwner()) onCleanup(() => {
    const current = owner.bridges.get(bridge)
    if (!current || --current.refs > 0) return
    current.detach()
    owner.bridges.delete(bridge)
    owner.model.retireBridge(bridge)
    if (owner.bridges.size) return
    live.delete(key)
    if (idle && idle !== owner) idle.dispose()
    idle = owner
  })
  let view = owner.views.get(bridge)
  if (!view) {
    const origin = (): AcornBridge => {
      if (!owner.bridges.has(bridge)) throw new Error('this HTTP panel region was retired')
      return bridge
    }
    view = {
      ...owner.model,
      client: createHttpClient(() => origin().api),
      persist: (draft) => owner.model.persist(draft, origin()),
      remove: (row) => owner.model.remove(row, origin()),
      fire: () => owner.model.fire(origin()),
      onSaveClick: () => owner.model.onSaveClick(origin()),
      copy: (text) => owner.model.copy(text, origin()),
      copyAsCurl: () => owner.model.copyAsCurl(origin()),
    }
    owner.views.set(bridge, view)
  }
  return view
}

/** A worker retains the latest inactive subject's model, without retaining a retired bridge. */
export const _resetHttpPanelModel = (): void => {
  for (const owner of live.values()) {
    for (const lease of owner.bridges.values()) lease.detach()
    owner.bridges.clear()
    owner.dispose()
  }
  live.clear()
  idle?.dispose()
  idle = null
}

function build(subject: PanelSubject, bridge: () => AcornBridge, hasBridge: (bridge: AcornBridge) => boolean) {
  const { projectId, projectName, taskId, initialRequestId } = subject
  const client = createHttpClient(() => bridge().api)
  // Retry only shared idempotent reads whose admitted lease retired. Each live bridge is tried at
  // most once per read; failures on a still-live bridge are published without a retry loop.
  const listRequests = async (projectId: string, taskId?: string): Promise<HttpRequest[]> => {
    const attempted = new Set<AcornBridge>()
    for (;;) {
      const origin = bridge()
      if (attempted.has(origin)) throw new Error('this HTTP panel read lost its mounted bridge')
      attempted.add(origin)
      try { return await createHttpClient(origin.api).listRequests(projectId, taskId) }
      catch (error) {
        if (hasBridge(origin)) throw error
        let next: AcornBridge
        try { next = bridge() } catch { throw error }
        if (attempted.has(next)) throw error
      }
    }
  }
  const blank = () => emptyDraft(taskId ?? null)
  const [selection, setSelection] = createSignal<Selection>({ kind: 'new' })
  const [draft, setDraft] = createSignal<Draft>(blank())
  const [result, setResult] = createSignal<SendResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveOpen, setSaveOpen] = createSignal(false)
  let savingOrigin: AcornBridge | null = null
  let sendingOrigin: AcornBridge | null = null

  // The repo tree. A task pane also lists that task's ad-hoc requests, in their own group above it.
  const [saved, savedActions] = createResource(() => listRequests(projectId))
  const [adhoc, adhocActions] = createResource(() => (taskId ? listRequests(projectId, taskId) : Promise.resolve([])))

  const refresh = () => {
    void savedActions.refetch()
    void adhocActions.refetch()
  }

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
  // The routed item first, then the selection that opened the pane. Those are two different arrivals:
  // a project surface's selection is in the URL and comes down as a prop, and a task pane opened by a
  // click or by the palette's curl import has no URL to hold one, so it arrives in `context`
  // (docs/plugins.md § The tree contract).
  const [requested, setRequested] = createSignal<string | undefined>(initialRequestId ?? bridge().context.item)
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
  const onSaveClick = (origin = bridge()) => (current() ? void persist(draft(), origin) : openSave())

  async function persist(d: Draft, origin = bridge()) {
    if (!d.name.trim()) return setError('Give the request a name before saving.')
    setSaving(true)
    setError(null)
    savingOrigin = origin
    const { updateRequest, createRequest } = createHttpClient(origin.api)
    try {
      const row = current()
      const next = row ? await updateRequest(projectId, row.id, d) : await createRequest(projectId, d)
      if (!hasBridge(origin)) return
      setSelection({ kind: 'saved', id: next.id })
      setDraft(toDraft(next))
      setSaveOpen(false)
      refresh()
    } catch (err) {
      if (!hasBridge(origin)) return
      setError(err instanceof Error ? err.message : 'Could not save the request')
    } finally {
      if (savingOrigin === origin) { savingOrigin = null; setSaving(false) }
    }
  }

  async function remove(row: HttpRequest, origin = bridge()) {
    const { deleteRequest } = createHttpClient(origin.api)
    try {
      await deleteRequest(projectId, row.id)
      if (!hasBridge(origin)) return
      if (current()?.id === row.id) startNew()
      refresh()
    } catch (err) {
      if (!hasBridge(origin)) return
      setError(err instanceof Error ? err.message : 'Could not delete the request')
    }
  }

  async function fire(origin = bridge()) {
    if (!draft().url.trim()) return setError('Enter a URL first.')
    setSending(true)
    setError(null)
    setResult(null)
    sendingOrigin = origin
    const { sendRequest } = createHttpClient(origin.api)
    try {
      // The panel decides where commands run (docs/http-client.md § Data model).
      const response = await sendRequest(projectId, toSendInput(draft(), taskId ?? null))
      if (hasBridge(origin)) setResult(response)
    } catch (err) {
      if (!hasBridge(origin)) return
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      if (sendingOrigin === origin) { sendingOrigin = null; setSending(false) }
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
  const copy = (text: string, origin = bridge()) => void origin.ui.copy(text)
  const copyAsCurl = (origin = bridge()) => copy(toCurl(draft()), origin)

  return {
    client, refresh,
    requestSelection: (item: string) => setRequested(item),
    retireBridge: (retired: AcornBridge) => {
      if (sendingOrigin === retired) { sendingOrigin = null; setSending(false) }
      if (savingOrigin === retired) { savingOrigin = null; setSaving(false) }
    },
    projectId,
    projectName,
    taskId,
    selection, setSelection,
    draft, patch, setDraft,
    result, error, setError,
    sending, saving,
    saveOpen, setSaveOpen, openSave, onSaveClick, saveTarget, persist,
    saved, adhoc, groups, folders,
    current, dirty,
    open, startNew, remove, fire,
    commitUrl, copy, copyAsCurl,
  }
}
