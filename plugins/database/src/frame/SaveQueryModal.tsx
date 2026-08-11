import { createSignal, Show } from 'solid-js'
import { Modal } from '@acorn/plugin-api/ui'
import type { DbSavedQuery } from '../shared/database'
import { saveQuery } from './databaseClient'

// Save the editor's SQL under a name for this project. Saving under a name that already exists
// overwrites it — that IS the edit/rename path, so the button says "Overwrite" when it will. The notes
// travel with the query into the AI prompt when it is picked as an example, so they are worth writing
// even for a query you only ever load by hand.
//
// The hand-rolled backdrop and `createDismissable` call this had as a compiled component are gone: the
// shared `Modal` on @acorn/plugin-api/ui does the same job and is frame-safe (props in, DOM out). One
// honest cost of the move, and it is small: a frame confined to the bottom region of a composed pane can
// only overlay THAT region, so this now covers the grid rather than the whole pane. The escape hatch if
// it ever grates is the `overlay` frame target, which is heavier — take it when the cramped modal is a
// real problem, not pre-emptively (docs/future/monaco.md § document-over-frame, concretely).
export default function SaveQueryModal(props: {
  taskId: string
  sql: string
  name: string // pre-filled from the last loaded query, so load → tweak → Save updates in place
  existing: readonly DbSavedQuery[]
  onClose: () => void
  onSaved: (query: DbSavedQuery) => void
}) {
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
      const saved = await saveQuery(props.taskId, { name: name().trim(), notes: notes(), sql: props.sql })
      props.onSaved(saved)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Save query"
      class="db-generate"
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return false
        void submit()
        return true
      }}
    >
      <Modal.Body class="db-generate-body">
        <input
          class="ui-input"
          type="text"
          maxlength="80"
          placeholder="Name — e.g. recent paid orders"
          // Not bare `autofocus`: it is unreliable inside a Solid modal, and a microtask-deferred focus
          // is the spelling that works.
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
      </Modal.Body>
      <div class="db-generate-actions">
        <button type="button" class="ui-btn" disabled={busy()} onClick={props.onClose}>Cancel</button>
        <button type="button" class="db-run-btn" disabled={busy() || !name().trim()} onClick={() => void submit()}>
          {busy() ? 'Saving…' : overwrites() ? 'Overwrite' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
