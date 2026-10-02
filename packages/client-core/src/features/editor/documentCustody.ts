import { Text, type EditorState } from '@codemirror/state'
import { deviceStorage, readLocal } from '../../kit/lib/state/deviceStorage'
import type { EditorViewState } from './viewState'

export type DocumentAcknowledgement = { text?: string; revision?: string }
export type DocumentWriter = (text: string) => Promise<DocumentAcknowledgement>
const documents = new Map<string, DocumentCustody>()
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
  state?: EditorState
  viewState?: EditorViewState
  error = ''
  private pending?: Promise<void>
  private requested = false
  private nextWrite?: DocumentWriter
  private recoveryTimer?: ReturnType<typeof setTimeout>
  private readers = 0
  private listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  constructor(private readonly key: string, loaded: string) {
    this.current = this.acknowledged = textOf(loaded)
    try {
      const recovery = JSON.parse(readLocal(key) ?? 'null') as { text?: unknown; acknowledged?: unknown; viewState?: EditorViewState } | null
      if (typeof recovery?.text === 'string') {
        this.current = textOf(recovery.text)
        if (typeof recovery.acknowledged === 'string') this.acknowledged = textOf(recovery.acknowledged)
        if (validViewState(recovery.viewState)) this.viewState = recovery.viewState
      }
    } catch { /* A malformed recovery record cannot replace loaded text. */ }
  }

  get dirty(): boolean { return !this.current.eq(this.acknowledged) }
  get writing(): boolean { return !!this.pending }

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

  edit(doc: Text): void {
    if (doc.eq(this.current)) return
    this.current = doc
    this.revision++
    documents.set(this.key, this)
    if (!this.recoveryTimer) this.recoveryTimer = setTimeout(() => this.flushRecovery(), 250)
  }

  reload(text: string): void {
    this.current = this.acknowledged = textOf(text)
    this.revision++
    this.flushRecovery()
  }

  flushRecovery(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
    // Keep the full document in memory if device storage is unavailable or out of quota.
    if (this.dirty || this.pending) documents.set(this.key, this)
    try {
      const storage = deviceStorage()
      if (this.dirty && !storage) throw new Error('No recovery storage')
      if (this.dirty) storage?.setItem(this.key, JSON.stringify({ text: this.current.toString(), acknowledged: this.acknowledged.toString(), viewState: this.viewState }))
      else storage?.removeItem(this.key)
    } catch {
      this.error = 'Recovery storage is unavailable. Keep acorn open until this document saves.'
      for (const listener of this.listeners) listener()
    }
    this.releaseClean()
  }

  /** Matching flushes share one operation; later edits occupy one follow-up slot. Failures reject. */
  flush(write: DocumentWriter): Promise<void> {
    this.requested = true
    this.nextWrite = write
    if (this.pending) return this.pending
    if (!this.dirty) { this.requested = false; this.nextWrite = undefined; return Promise.resolve() }
    this.flushRecovery()
    const run = async () => {
      try {
        while (this.requested) {
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
      }
    }
    this.pending = run()
    return this.pending
  }
}

const recoveryKey = (address: readonly (string | null)[]): string => `acorn.document.recovery.${JSON.stringify(address)}`

export function recoverDocumentCustody(address: readonly (string | null)[]): DocumentCustody | undefined {
  const key = recoveryKey(address)
  const held = documents.get(key)
  if (held) return held
  try {
    const recovery = JSON.parse(readLocal(key) ?? 'null') as { text?: unknown } | null
    if (typeof recovery?.text === 'string') return new DocumentCustody(key, '')
  } catch { /* Invalid device recovery is not a document. */ }
  return undefined
}

export function documentCustody(address: readonly (string | null)[], loaded: string): DocumentCustody {
  const key = recoveryKey(address)
  return documents.get(key) ?? new DocumentCustody(key, loaded)
}
