import { Text, type EditorState } from '@codemirror/state'
import { deviceStorage, readLocal } from '../../kit/lib/state/deviceStorage'
import type { EditorViewState } from './viewState'

export type DocumentAcknowledgement = { text?: string; revision?: string }
export type DocumentWriter = (text: string) => Promise<DocumentAcknowledgement>
const documents = new Map<string, DocumentCustody>()
const reservations = new Map<string, DocumentCustody | null>()
const sourceHolds = new Set<{ nodeId: string | null; taskId: string; prefix: string; held: Map<DocumentCustody, { path: string; release: () => void }> }>()
const textOf = (text: string): Text => Text.of(text.split('\n'))
const validViewState = (value: EditorViewState | undefined): value is EditorViewState => !!value
  && Number.isSafeInteger(value.anchor) && value.anchor >= 0
  && Number.isSafeInteger(value.head) && value.head >= 0
  && Number.isFinite(value.scrollTop) && value.scrollTop >= 0

/** A document address owns writes and recovery independently of its mounted editor or grant. */
export class DocumentCustody {
  current: Text
  acknowledged: Text
  revision = 0
  acknowledgedRevision?: string
  /** A file conflict or missing file pauses automatic writes; host documents leave this empty. */
  writeBlock = ''
  /** Set by the file editor when dirty recovery needs a person's decision. */
  requiresResolution = false
  state?: EditorState
  viewState?: EditorViewState
  error = ''
  private pending?: Promise<void>
  private requested = false
  private nextWrite?: DocumentWriter
  private recoveryTimer?: ReturnType<typeof setTimeout>
  private readers = 0
  private listeners = new Set<() => void>()
  private suspensionCount = 0
  private retired = false

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  constructor(private key: string, loaded: string, diskRevision?: string) {
    this.current = this.acknowledged = textOf(loaded)
    this.acknowledgedRevision = diskRevision
    try {
      const recovery = JSON.parse(readLocal(key) ?? 'null') as { text?: unknown; acknowledged?: unknown; acknowledgedRevision?: unknown; viewState?: EditorViewState } | null
      if (typeof recovery?.text === 'string') {
        this.current = textOf(recovery.text)
        if (typeof recovery.acknowledged === 'string') this.acknowledged = textOf(recovery.acknowledged)
        this.acknowledgedRevision = typeof recovery.acknowledgedRevision === 'string' ? recovery.acknowledgedRevision : undefined
        if (validViewState(recovery.viewState)) this.viewState = recovery.viewState
      }
    } catch { /* A malformed recovery record cannot replace loaded text. */ }
  }

  get dirty(): boolean { return !this.current.eq(this.acknowledged) }
  get writing(): boolean { return !!this.pending }
  get savedRevision(): string | undefined { return this.acknowledgedRevision }

  /** Old pane callbacks must not write a path after custody moves or is retired. */
  ownsFile(taskId: string, path: string): boolean {
    if (this.retired) return false
    try {
      const address = JSON.parse(this.key.slice('acorn.document.recovery.'.length)) as unknown
      return Array.isArray(address) && address[1] === 'file' && address[2] === taskId && address[3] === path
    } catch { return false }
  }

  retain(): () => void {
    this.readers++
    documents.set(this.key, this)
    let released = false
    return () => {
      if (released) return
      released = true
      this.readers--
      this.flushRecovery()
      this.releaseClean()
    }
  }

  private releaseClean(): void {
    if (!this.readers && !this.dirty && !this.pending && documents.get(this.key) === this) documents.delete(this.key)
  }

  editText(text: string): void { this.edit(textOf(text)) }

  edit(doc: Text): void {
    if (doc.eq(this.current)) return
    this.current = doc
    this.revision++
    documents.set(this.key, this)
    if (!this.recoveryTimer) this.recoveryTimer = setTimeout(() => this.flushRecovery(), 250)
  }

  reload(text: string, diskRevision?: string): void {
    this.current = this.acknowledged = textOf(text)
    this.acknowledgedRevision = diskRevision
    this.writeBlock = ''
    this.requiresResolution = false
    this.revision++
    this.flushRecovery()
  }

  /** A deliberate file resolution may finish after more typing; retain those newer edits. */
  acknowledgeResolved(text: string, diskRevision: string, admittedRevision: number): void {
    this.acknowledged = textOf(text)
    this.acknowledgedRevision = diskRevision
    if (this.revision === admittedRevision) this.current = this.acknowledged
    this.writeBlock = ''
    this.requiresResolution = false
    this.flushRecovery()
    for (const listener of this.listeners) listener()
  }

  flushRecovery(): boolean {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
    // Keep the full document in memory if device storage is unavailable or out of quota.
    if (this.dirty || this.pending) documents.set(this.key, this)
    try {
      const storage = deviceStorage()
      if (this.dirty && !storage) throw new Error('No recovery storage')
      if (this.dirty) storage?.setItem(this.key, JSON.stringify({ text: this.current.toString(), acknowledged: this.acknowledged.toString(), acknowledgedRevision: this.acknowledgedRevision, viewState: this.viewState }))
      else storage?.removeItem(this.key)
    } catch {
      this.error = 'Recovery storage is unavailable. Keep acorn open until this document saves.'
      for (const listener of this.listeners) listener()
      return false
    }
    this.releaseClean()
    return true
  }

  /** Matching flushes share one operation; later edits occupy one follow-up slot. Failures reject. */
  flush(write: DocumentWriter): Promise<void> {
    return this.flushWithPermission(write, false)
  }

  /** A confirmed file operation may save a draft while its ordinary writers stay suspended. */
  flushForFileAction(write: DocumentWriter): Promise<void> {
    if (!this.suspensionCount) return Promise.reject(new Error('Suspend document writes before a file action.'))
    return this.flushWithPermission(write, true)
  }

  private flushWithPermission(write: DocumentWriter, allowSuspended: boolean): Promise<void> {
    if (this.retired || this.suspensionCount && !allowSuspended) return Promise.resolve()
    if (this.writeBlock || this.requiresResolution) return Promise.reject(new Error(this.writeBlock || 'Document writes are blocked.'))
    this.requested = true
    this.nextWrite = write
    if (this.pending) return this.pending
    if (!this.dirty) { this.requested = false; this.nextWrite = undefined; return Promise.resolve() }
    this.flushRecovery()
    const run = async () => {
      try {
        while (this.requested && (!this.suspensionCount || allowSuspended) && !this.writeBlock && !this.requiresResolution) {
          this.requested = false
          if (!this.dirty) continue
          const submitted = this.current
          const revision = this.revision
          const writer = this.nextWrite!
          this.nextWrite = undefined
          const result = await writer(submitted.toString())
          this.acknowledged = result.text === undefined ? submitted : textOf(result.text)
          this.acknowledgedRevision = result.revision
          // Formatting replaces the submitted edit only when nobody has edited since admission.
          if (this.revision === revision) {
            this.current = this.acknowledged
            if (this.state && !this.state.doc.eq(this.current)) {
              this.state = this.state.update({ changes: { from: 0, to: this.state.doc.length, insert: this.current } }).state
            }
          }
          this.error = ''
          for (const listener of this.listeners) listener()
          this.flushRecovery()
        }
      } catch (cause) {
        this.requested = false
        this.error = cause instanceof Error ? cause.message : String(cause)
        this.flushRecovery()
        throw cause
      } finally {
        this.pending = undefined
        this.nextWrite = undefined
        this.releaseClean()
        for (const listener of this.listeners) listener()
      }
    }
    this.pending = run()
    return this.pending
  }

  /** Stop new and queued writes, then join an admitted write before a file mutation. */
  async suspendWrites(): Promise<() => void> {
    const release = this.holdWrites()
    await this.pending?.catch(() => {})
    return release
  }

  /** Count a hold before an asynchronously loaded document can queue a save. */
  holdWrites(): () => void {
    this.suspensionCount++
    this.requested = false
    let resumed = false
    return () => {
      if (resumed) return
      resumed = true
      this.suspensionCount--
    }
  }

  /** Move a suspended file's recovery identity after a successful path mutation. */
  assertCanRebind(address: readonly (string | null)[]): void {
    const next = recoveryKey(address)
    if (next === this.key) return
    const held = documents.get(next)
    const reserved = reservations.get(next)
    if ((held && held !== this) || readLocal(next) !== null || reserved !== undefined && reserved !== this) {
      throw new Error('The destination document already has open or recovered text.')
    }
  }

  rebind(address: readonly (string | null)[]): void {
    if (!this.suspensionCount) throw new Error('Suspend document writes before rebinding.')
    const next = recoveryKey(address)
    this.assertCanRebind(address)
    const previous = this.key
    if (documents.get(previous) === this) documents.delete(previous)
    this.key = next
    documents.set(next, this)
    if (this.flushRecovery()) {
      try { deviceStorage()?.removeItem(previous) } catch { /* The old copy is safe to retain. */ }
    }
  }

  /** A confirmed trash removes local recovery and disables closures captured at the old path. */
  retireFile(): void {
    if (!this.suspensionCount || this.dirty || this.pending) throw new Error('Save and suspend a draft before retiring it.')
    this.retired = true
    if (documents.get(this.key) === this) documents.delete(this.key)
    try { deviceStorage()?.removeItem(this.key) } catch { /* No dirty recovery remains. */ }
  }
}

const recoveryKey = (address: readonly (string | null)[]): string => `acorn.document.recovery.${JSON.stringify(address)}`

export function recoverDocumentCustody(address: readonly (string | null)[]): DocumentCustody | undefined {
  const key = recoveryKey(address)
  const held = documents.get(key)
  if (held) { holdSourceCustody(address, held); return held }
  if (reservations.has(key)) return undefined
  try {
    const recovery = JSON.parse(readLocal(key) ?? 'null') as { text?: unknown } | null
    if (typeof recovery?.text === 'string') {
      const custody = new DocumentCustody(key, '')
      documents.set(key, custody)
      holdSourceCustody(address, custody)
      return custody
    }
  } catch { /* Invalid device recovery is not a document. */ }
  return undefined
}

export function documentCustody(address: readonly (string | null)[], loaded: string, diskRevision?: string): DocumentCustody {
  const key = recoveryKey(address)
  if (reservations.has(key)) throw new Error('A file action is moving into this path. Wait for it to finish, then reopen the document or resolve its recovery.')
  const custody = documents.get(key) ?? new DocumentCustody(key, loaded, diskRevision)
  holdSourceCustody(address, custody)
  return custody
}

function holdSourceCustody(address: readonly (string | null)[], custody: DocumentCustody): void {
  if (address.length !== 4 || address[1] !== 'file' || typeof address[2] !== 'string' || typeof address[3] !== 'string') return
  for (const hold of sourceHolds) {
    if (hold.nodeId !== address[0] || hold.taskId !== address[2] || hold.prefix !== '' && address[3] !== hold.prefix && !address[3].startsWith(`${hold.prefix}/`)) continue
    if (!hold.held.has(custody)) hold.held.set(custody, { path: address[3], release: custody.holdWrites() })
  }
}

/** Hold descendants acquired by a pending read or a new pane after the menu was armed. */
export function reserveFileSourceCustodies(nodeId: string | null, taskId: string, prefix: string): { release: () => void; custodies: () => Map<string, DocumentCustody> } {
  const hold = { nodeId, taskId, prefix, held: new Map<DocumentCustody, { path: string; release: () => void }>() }
  sourceHolds.add(hold)
  fileDocumentCustodies(nodeId, taskId, prefix)
  let released = false
  const release = () => {
    if (released) return
    released = true
    sourceHolds.delete(hold)
    for (const entry of hold.held.values()) entry.release()
  }
  return { release, custodies: () => new Map([...hold.held].map(([custody, entry]) => [entry.path, custody])) }
}

/** The custody owner enumerates in-memory and persisted drafts without leaking storage keys to a pane. */
export function fileDocumentCustodies(nodeId: string | null, taskId: string, prefix: string): Map<string, DocumentCustody> {
  const keys = new Set(documents.keys())
  try {
    const storage = deviceStorage()
    if (storage) for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith('acorn.document.recovery.')) keys.add(key)
    }
  } catch { /* In-memory custody remains available when device storage is blocked. */ }
  const result = new Map<string, DocumentCustody>()
  for (const key of keys) {
    try {
      if (!key.startsWith('acorn.document.recovery.')) continue
      const address = JSON.parse(key.slice('acorn.document.recovery.'.length)) as unknown
      if (!Array.isArray(address) || address.length !== 4 || address[0] !== nodeId || address[1] !== 'file' || address[2] !== taskId) continue
      const path = address[3]
      if (typeof path !== 'string' || prefix !== '' && path !== prefix && !path.startsWith(`${prefix}/`)) continue
      const custody = recoverDocumentCustody(address)
      if (custody) result.set(path, custody)
    } catch { /* Invalid keys are not file recovery. */ }
  }
  return result
}

/** Reserve every destination before a Node mutation; routine opens cannot claim it mid-flight. */
export function reserveDocumentDestinations(entries: readonly { address: readonly (string | null)[]; custody?: DocumentCustody }[]): () => void {
  const held: string[] = []
  try {
    for (const entry of entries) {
      const key = recoveryKey(entry.address)
      if (reservations.has(key) || documents.has(key) && documents.get(key) !== entry.custody || readLocal(key) !== null) {
        throw new Error('The destination document already has open or recovered text.')
      }
      reservations.set(key, entry.custody ?? null)
      held.push(key)
    }
  } catch (cause) {
    for (const key of held) reservations.delete(key)
    throw cause
  }
  let released = false
  return () => { if (released) return; released = true; for (const key of held) reservations.delete(key) }
}
