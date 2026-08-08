import { createSignal, Show } from 'solid-js'
import { createDismissable } from '@acorn/plugin-api/client'
import type { DbSavedQuery } from '../shared/database'
import { databaseApi } from './databaseClient'

// Save the editor's SQL under a name for this repo (docs/pg.md). Saving under a name that already
// exists overwrites it — that IS the edit/rename path, so the button says "Overwrite" when it will.
// The notes travel with the query into the AI prompt when it's picked as an example, so they're worth
// writing even for a query you only ever load by hand.
export default function SaveQueryModal(props: {
  taskId: string
  sql: string
  name: string // pre-filled from the last loaded query, so load → tweak → Save updates in place
  existing: readonly DbSavedQuery[]
  onClose: () => void
  onSaved: (query: DbSavedQuery) => void
}) {
  const api = databaseApi()
  const [name, setName] = createSignal(props.name)
  const [notes, setNotes] = createSignal(props.existing.find((q) => q.name === props.name)?.notes ?? '')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const overwrites = () => props.existing.some((q) => q.name === name().trim())

  const submit = async () => {
    if (busy() || !name().trim()) return
    setBusy(true)
    setError('')
    try {
      const saved = await api.saveQuery(props.taskId, { name: name().trim(), notes: notes(), sql: props.sql })
      props.onSaved(saved)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  let dialog!: HTMLDivElement
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => dialog })
  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div
        ref={dialog}
        class="overlay db-generate"
        role="dialog"
        aria-modal="true"
        onClick={dismiss.onContainerClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
          else dismiss.onKeyDown(event)
        }}
      >
        <div class="overlay-title">Save query</div>
        <div class="overlay-body db-generate-body">
          <input
            class="ui-input"
            type="text"
            maxlength="80"
            placeholder="Name — e.g. recent paid orders"
            ref={(el) => queueMicrotask(() => el.focus())}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <textarea
            class="settings-script"
            rows="3"
            maxlength="2000"
            spellcheck={false}
            placeholder="Notes — what it answers, gotchas. Sent to the AI with the query when used as an example."
            value={notes()}
            onInput={(e) => setNotes(e.currentTarget.value)}
          />
          <pre class="db-sql-preview">{props.sql}</pre>
          <Show when={error()}>
            <div class="db-error">{error()}</div>
          </Show>
        </div>
        <div class="db-generate-actions">
          <button type="button" class="ui-btn" disabled={busy()} onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="db-run-btn" disabled={busy() || !name().trim()} onClick={() => void submit()}>
            {busy() ? 'Saving…' : overwrites() ? 'Overwrite' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
