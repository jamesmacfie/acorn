// Where a request gets its name, its folder and (in a task) its home. This is a modal rather than two
// always-visible fields in the panel's metabar, because naming is a save-time decision — inputs sat
// above the request tabs read as part of the request itself.
import { createSignal, For, Show } from 'solid-js'
import { Modal } from '@acorn/client-core/ui/Modal.tsx'
import { Button, Field, Input, Select } from '@acorn/client-core/ui/primitives.tsx'

export type SaveTarget = { name: string; folder: string; scope: 'task' | 'repo' }

export default function SaveRequestModal(props: {
  target: SaveTarget
  /** Mounted as a task pane, so "keep with this task" is on offer at all. */
  inTask: boolean
  /** Folders already in use in this repo — offered as completions, not as a closed list. */
  folders: readonly string[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (target: SaveTarget) => void
}) {
  const [name, setName] = createSignal(props.target.name)
  const [folder, setFolder] = createSignal(props.target.folder)
  const [scope, setScope] = createSignal(props.target.scope)

  const submit = () => {
    if (props.busy || !name().trim()) return
    props.onSave({ name: name().trim(), folder: folder().trim().replace(/^\/+|\/+$/g, ''), scope: scope() })
  }

  return (
    <Modal
      title="Save request"
      size="sm"
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        submit()
        return true
      }}
    >
      <Modal.Body>
        <Field label="Name">
          <Input
            value={name()}
            maxlength={120}
            placeholder="List users"
            ref={(el) => queueMicrotask(() => el.select())}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </Field>

        <Show when={props.inTask}>
          <Field label="Keep in" hint={scope() === 'task' ? 'Stays with this task and goes when the task does.' : "Filed in the repo's tree, available from every task."}>
            <Select value={scope()} onChange={(e) => setScope(e.currentTarget.value as 'task' | 'repo')}>
              <option value="task">This task</option>
              <option value="repo">The repo</option>
            </Select>
          </Field>
        </Show>

        {/* A datalist, not a picker: existing folders are suggestions and a new path is just typed. */}
        <Show when={scope() === 'repo'}>
          <Field label="Folder" hint="Slash-separated. Leave blank for the top of the tree.">
            <Input
              value={folder()}
              list="http-folder-options"
              placeholder="auth/admin"
              spellcheck={false}
              onInput={(e) => setFolder(e.currentTarget.value)}
            />
          </Field>
          <datalist id="http-folder-options">
            <For each={props.folders}>{(f) => <option value={f} />}</For>
          </datalist>
        </Show>

        <Show when={props.error}>
          <p class="http-response-error" role="alert">{props.error}</p>
        </Show>
      </Modal.Body>

      <Modal.Actions>
        <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
        <Button variant="solid" tone="accent" busy={props.busy} disabled={!name().trim()} onClick={submit}>
          Save
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
