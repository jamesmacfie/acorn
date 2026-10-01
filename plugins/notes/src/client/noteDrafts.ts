// Notes owns this recovery state. It contains only edits not yet acknowledged by the originating
// Node, partitioned by the complete document address. There is no automatic offline replay.
import { readLocal, writeLocal } from '@acorn/plugin-api/client'
import type { NoteLocation, NotesApi } from './notesClient'

type Edit = { value: string; revision: number }
type Recovery = { body?: Edit; title?: Edit; error?: string }
const drafts = new Map<string, NoteDraft>()
const address = (nodeId: string | null, location: NoteLocation, slug: string): string =>
  `acorn.notes.draft.${JSON.stringify([nodeId, location.scope, 'taskId' in location ? location.taskId : 'workspaceId' in location ? location.workspaceId : null, slug])}`

export class NoteDraft {
  private recovery: Recovery = {}
  private revision = 0
  private acknowledged = { body: 0, title: 0 }
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined
  private pendingSave: Promise<string> | undefined
  private saveRequested = false
  private operations = 0
  private readers = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly key: string, private readonly location: NoteLocation, private readonly slug: string) {
    try {
      const saved = JSON.parse(readLocal(key) ?? 'null') as Recovery | null
      if (saved && [saved.body, saved.title].every((edit) => !edit || (typeof edit.value === 'string' && Number.isSafeInteger(edit.revision) && edit.revision > 0))) {
        this.recovery = saved
        this.revision = Math.max(saved.body?.revision ?? 0, saved.title?.revision ?? 0)
      }
    } catch { /* An invalid device scrap cannot replace the Node's document. */ }
  }

  get body(): string | undefined { return this.recovery.body?.value }
  get title(): string | undefined { return this.recovery.title?.value }
  get error(): string { return this.recovery.error ?? '' }
  get dirty(): boolean { return !!(this.recovery.body || this.recovery.title) }

  retain(): () => void {
    this.readers++
    drafts.set(this.key, this)
    let released = false
    return () => {
      if (released) return
      released = true
      this.readers--
      if (!this.dirty && !this.operations && !this.readers && drafts.get(this.key) === this) drafts.delete(this.key)
    }
  }

  edit(field: 'body' | 'title', value: string): void {
    this.recovery[field] = { value, revision: ++this.revision }
    drafts.set(this.key, this)
    if (this.recoveryTimer === undefined) this.recoveryTimer = setTimeout(() => this.flushRecovery(), 250)
  }

  flushRecovery(): void {
    if (this.recoveryTimer !== undefined) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
    this.persist()
  }

  private persist(): void {
    if (this.dirty) drafts.set(this.key, this)
    else if (!this.operations && !this.readers && drafts.get(this.key) === this) drafts.delete(this.key)
    writeLocal(this.key, this.dirty ? JSON.stringify(this.recovery) : '')
  }

  // Body, title and inclusion/removal all use the same queue: the Node implements them as separate
  // read/modify/write operations. An acknowledgement clears exactly the local edit it sent.
  run<T>(operation: () => Promise<T>): Promise<T> {
    this.operations++
    drafts.set(this.key, this)
    const next = this.queue.then(operation).finally(() => {
      this.operations--
      if (!this.dirty && !this.operations && !this.readers && drafts.get(this.key) === this) drafts.delete(this.key)
    })
    this.queue = next.catch(() => {})
    return next
  }

  save(api: NotesApi): Promise<string> {
    this.saveRequested = true
    if (this.pendingSave) return this.pendingSave
    // One active operation and a flag for the latest follow-up. Queued requests never retain a
    // succession of obsolete full bodies while HTTP is held.
    this.pendingSave = this.run(async () => {
      try {
        let error = ''
        while (this.saveRequested) {
          this.saveRequested = false
          const body = this.recovery.body
          const title = this.recovery.title
          error = ''
          for (const [field, edit] of [['body', body], ['title', title]] as const) {
            if (!edit || (field === 'title' && !edit.value.trim()) || edit.revision <= this.acknowledged[field]) continue
            try {
              const result = field === 'body' ? await api.write(this.location, this.slug, edit.value) : await api.setTitle(this.location, this.slug, edit.value.trim())
              if ('error' in result) throw new Error(result.error)
              if (!result.ok) throw new Error('The note was not saved.')
              this.acknowledged[field] = edit.revision
              if (this.recovery[field]?.revision === edit.revision) delete this.recovery[field]
            } catch (failure) {
              error = failure instanceof Error ? failure.message : String(failure)
            }
            this.recovery.error = error || undefined
            this.flushRecovery()
          }
        }
        return error
      } finally { this.pendingSave = undefined }
    })
    return this.pendingSave
  }

  fail(message: string): void {
    this.recovery.error = message
    this.flushRecovery()
  }

  discard(): void {
    this.recovery = {}
    this.flushRecovery()
  }
}

export function noteDraft(nodeId: string | null, location: NoteLocation, slug: string): NoteDraft {
  const key = address(nodeId, location, slug)
  let draft = drafts.get(key)
  if (!draft) { draft = new NoteDraft(key, location, slug); if (draft.dirty) drafts.set(key, draft) }
  return draft
}
