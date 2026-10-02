import { createEffect, createMemo, createResource, createSignal, onCleanup } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { fromCurl, toCurl, type HttpRequest, type SendResult } from '../shared/model'
import { createHttpClient } from './httpClient'
import { emptyDraft, toDraft, toSendInput, type Draft } from './draft'
import type { SaveTarget } from './SaveRequestModal'
import type { PanelSubject, Selection } from './panelModel'
import { groupByFolder } from './requestGroups'
import { createDraftEntry, entryDirty, snapshotDraft, type DraftEntry, type DraftRecovery } from './draftRecovery'
import { withAbort } from './requestOperation'
import { serializeHttpWrite } from './httpWrites'

export function buildPanel(subject: PanelSubject, bridge: () => AcornBridge, hasBridge: (bridge: AcornBridge) => boolean, recovery: DraftRecovery) {
  const { projectId, projectName, taskId, initialRequestId } = subject
  const client = createHttpClient(() => bridge().api)
  let disposed = false
  const operations = new Map<AbortController, AcornBridge>()
  const admit = (origin: AcornBridge) => {
    const controller = new AbortController()
    if (disposed || !hasBridge(origin)) controller.abort()
    else operations.set(controller, origin)
    return controller
  }
  onCleanup(() => {
    disposed = true
    for (const controller of operations.keys()) controller.abort()
    operations.clear()
    for (const [key, entry] of recovery.entries) if (!entryDirty(entry) && !entry.write) recovery.entries.delete(key)
    setSaving(false)
    setSending(false)
  })
  const lastLists = new Map<string, HttpRequest[]>()
  // Retry only shared idempotent reads whose admitted lease retired. Each live bridge is tried at
  // most once per read; failures on a still-live bridge are published without a retry loop.
  const listRequests = async (projectId: string, taskId?: string): Promise<HttpRequest[]> => {
    const attempted = new Set<AcornBridge>()
    for (;;) {
      const origin = bridge()
      if (attempted.has(origin)) throw new Error('this HTTP panel read lost its mounted bridge')
      attempted.add(origin)
      const controller = admit(origin)
      try {
        const rows = await withAbort(controller.signal, () => createHttpClient(origin.api).listRequests(projectId, taskId, controller.signal))
        lastLists.set(taskId ?? '', rows)
        return rows
      }
      catch (error) {
        if (disposed || hasBridge(origin)) {
          if (!disposed) setError(error instanceof Error ? error.message : 'Could not refresh requests')
          return lastLists.get(taskId ?? '') ?? []
        }
        let next: AcornBridge
        try { next = bridge() } catch { return lastLists.get(taskId ?? '') ?? [] }
        if (attempted.has(next)) return lastLists.get(taskId ?? '') ?? []
      } finally { operations.delete(controller) }
    }
  }
  const blank = () => emptyDraft(taskId ?? null)
  let active: DraftEntry = recovery.entries.get(recovery.selected ?? '') ?? createDraftEntry(blank())
  recovery.entries.set(active.key, active)
  recovery.selected = active.key
  let generation = 0
  const [selection, publishSelection] = createSignal<Selection>(active.id ? { kind: 'saved', id: active.id } : { kind: 'new' })
  const [draft, publishDraft] = createSignal<Draft>(snapshotDraft(active.draft))
  const [recoveryVersion, bumpRecovery] = createSignal(0)
  const changed = () => bumpRecovery((value) => value + 1)
  const setDraft = (value: Draft) => {
    active.draft = value
    active.revision++
    publishDraft(active.draft)
    changed()
  }
  const [result, setResult] = createSignal<SendResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveOpen, setSaveOpen] = createSignal(false)
  let sendingController: AbortController | null = null
  const writes = new Map<DraftEntry, number>()
  const settleSaving = () => setSaving((writes.get(active) ?? 0) > 0)
  const setSelection = (next: Selection) => {
    generation++
    sendingController?.abort()
    sendingController = null
    setSending(false)
    setResult(null)
    setError(null)
    setSaveOpen(false)
    publishSelection(next)
    settleSaving()
  }

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

  const dirty = createMemo(() => { recoveryVersion(); return entryDirty(active) })
  const recoveries = createMemo(() => {
    recoveryVersion()
    return [...recovery.entries.values()].filter((entry) => entry !== active && entryDirty(entry))
      .map((entry) => ({ key: entry.key, name: entry.draft.name }))
  })
  const patch = (p: Partial<Draft>) => setDraft({ ...draft(), ...p })

  function selectEntry(entry: DraftEntry) {
    active = entry
    recovery.selected = entry.key
    setSelection(entry.id ? { kind: 'saved', id: entry.id } : { kind: 'new' })
    publishDraft(snapshotDraft(entry.draft))
    changed()
  }
  function recover(key: string) {
    const entry = recovery.entries.get(key)
    if (entry) selectEntry(entry)
  }
  function open(row: HttpRequest) {
    let entry = [...recovery.entries.values()].find((candidate) => candidate.id === row.id)
    if (!entry) entry = createDraftEntry(toDraft(row), row.id)
    else if (!entryDirty(entry) && !entry.write) {
      entry.draft = toDraft(row)
      entry.baseline = toDraft(row)
    }
    recovery.entries.set(entry.key, entry)
    selectEntry(entry)
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
    // A duplicate is an independent unsaved request. Dirty prior entries remain recoverable.
    if (!entryDirty(active) && !active.write) recovery.entries.delete(active.key)
    const entry = createDraftEntry(blank())
    if (from) entry.draft = { ...toDraft(from), name: `${from.name} copy`, taskId: taskId ?? null, folder: taskId ? '' : from.folder }
    recovery.entries.set(entry.key, entry)
    selectEntry(entry)
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
    const entry = active, selectedGeneration = generation, revision = entry.revision
    const submitted = snapshotDraft(d)
    const controller = admit(origin)
    const previous = entry.write
    writes.set(entry, (writes.get(entry) ?? 0) + 1)
    settleSaving()
    setError(null)
    const operation = (async () => {
      try {
        // A second save of a new draft waits for its ID, then updates that same row.
        if (previous) await withAbort(controller.signal, () => previous)
        controller.signal.throwIfAborted()
        const api = createHttpClient(origin.api)
        const identity = JSON.stringify([origin.context.nodeId ?? origin.context.authority, projectId, 'request', entry.id ?? entry.key])
        const next = await serializeHttpWrite(identity, controller.signal, () => withAbort(controller.signal, () => entry.id
          ? api.updateRequest(projectId, entry.id, submitted, controller.signal)
          : api.createRequest(projectId, submitted, controller.signal)))
        entry.id = next.id
        entry.baseline = toDraft(next)
        entry.failed = false
        if (entry.revision === revision) entry.draft = toDraft(next)
        if (!disposed && hasBridge(origin) && active === entry && generation === selectedGeneration) {
          publishSelection({ kind: 'saved', id: next.id })
          publishDraft(snapshotDraft(entry.draft))
          setSaveOpen(false)
        }
        if (!disposed && hasBridge(origin)) refresh()
      } catch (err) {
        entry.failed = true
        if (!disposed && hasBridge(origin) && active === entry && generation === selectedGeneration)
          setError(err instanceof Error ? err.message : 'Could not save the request')
      } finally {
        operations.delete(controller)
        writes.set(entry, (writes.get(entry) ?? 1) - 1)
        if (!disposed) { settleSaving(); changed() }
      }
    })()
    entry.write = operation
    await operation
    if (entry.write === operation) entry.write = undefined
  }

  async function remove(row: HttpRequest, origin = bridge()) {
    const selectedGeneration = generation
    const controller = admit(origin)
    let entry = [...recovery.entries.values()].find((candidate) => candidate.id === row.id)
    if (!entry) { entry = createDraftEntry(toDraft(row), row.id); recovery.entries.set(entry.key, entry) }
    const target = entry, revision = target.revision, previous = target.write
    let operation!: Promise<void>
    operation = (async () => {
      try {
        if (previous) await withAbort(controller.signal, () => previous)
        const identity = JSON.stringify([origin.context.nodeId ?? origin.context.authority, projectId, 'request', row.id])
        await serializeHttpWrite(identity, controller.signal, () => withAbort(controller.signal, () => createHttpClient(origin.api).deleteRequest(projectId, row.id, controller.signal)))
        if (disposed || !hasBridge(origin)) return
        target.id = undefined
        if (target.revision === revision && target.write === operation) {
          recovery.entries.delete(target.key)
          if (active === target && generation === selectedGeneration) startNew()
        } else {
          // Text entered during deletion becomes an unsaved recovery; it is never written back automatically.
          target.id = undefined
          target.failed = true
          if (active === target && generation === selectedGeneration) publishSelection({ kind: 'new' })
        }
        changed()
        refresh()
      } catch (err) {
        if (!disposed && hasBridge(origin) && generation === selectedGeneration)
          setError(err instanceof Error ? err.message : 'Could not delete the request')
      } finally { operations.delete(controller) }
    })()
    target.write = operation
    await operation
    if (target.write === operation) target.write = undefined
  }

  async function fire(origin = bridge()) {
    if (!draft().url.trim()) return setError('Enter a URL first.')
    sendingController?.abort()
    const controller = admit(origin)
    sendingController = controller
    const entry = active, selectedGeneration = generation, revision = entry.revision
    const submitted = toSendInput(snapshotDraft(draft()), taskId ?? null)
    setSending(true)
    setError(null)
    setResult(null)
    const publish = () => !disposed && hasBridge(origin) && active === entry && generation === selectedGeneration && entry.revision === revision && sendingController === controller
    try {
      const response = await withAbort(controller.signal, () => createHttpClient(origin.api).sendRequest(projectId, submitted, controller.signal))
      if (publish()) setResult(response)
    } catch (err) {
      if (publish() && !controller.signal.aborted) setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      operations.delete(controller)
      if (sendingController === controller) { sendingController = null; setSending(false) }
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
      for (const [controller, origin] of operations) if (origin === retired) controller.abort()
    },
    recoveries, recover,
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
