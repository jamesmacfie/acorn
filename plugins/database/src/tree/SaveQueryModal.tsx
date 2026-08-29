import { createSignal, Show } from 'solid-js'
import { Alert, Button, CodeBlock, Input, Modal, ModalActions, ModalBody, Textarea } from '@acorn/plugin-api/ui/tree'
import type { DbSavedQuery } from '../shared/database'
import { saveQuery } from './databaseClient'

// Save the editor's SQL under a name for this project. Saving under a name that already exists
// overwrites it, so the button says "Overwrite" when it will. The notes travel with the query into the
// AI prompt when it is picked as an example.
//
// The host draws the dialog now, so it covers the window rather than only this pane's lower region:
// a tree is not confined to a rectangle the way the iframe was. That is the one visible difference the
// move made here, and it is the better of the two.
export default function SaveQueryModal(props: {
  taskId: string
  sql: string
  name: string // pre-filled from the last loaded query, so load → tweak → Save updates in place
  existing: readonly DbSavedQuery[]
  onDismiss: () => void
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
      props.onDismiss()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    // ⌘Enter used to be a `keydown` on the dialog. A DOM event does not cross to a sandbox with no
    // DOM, so the name field's own submit carries it: Enter in the name saves, which is the gesture
    // anyone reaching for ⌘Enter in a two-field dialog was already close to.
    <Modal title="Save query" onDismiss={props.onDismiss}>
      <ModalBody>
        <Input
          type="text"
          maxLength={80}
          placeholder="Name — e.g. recent paid orders"
          autofocus
          value={name()}
          onChange={(value: string) => setName(value)}
          onSubmit={(value: string) => {
            setName(value)
            void submit()
          }}
        />
        <Textarea
          mono
          rows={3}
          maxLength={2000}
          assist={false}
          placeholder="Notes — what it answers, gotchas. Sent to the AI with the query when used as an example."
          value={notes()}
          onChange={(value: string) => setNotes(value)}
        />
        <CodeBlock size="xs" maxHeight="block" wrap>{props.sql}</CodeBlock>
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
      </ModalBody>
      <ModalActions>
        <Button disabled={busy()} onPress={props.onDismiss}>Cancel</Button>
        <Button variant="solid" disabled={busy() || !name().trim()} onPress={() => void submit()}>
          {busy() ? 'Saving…' : overwrites() ? 'Overwrite' : 'Save'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
