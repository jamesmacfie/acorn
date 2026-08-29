// Where a request gets its name, its folder, and in a task its home. A modal rather than two fields
// in the panel's metabar, because naming is a save-time decision. Inputs above the request tabs read
// as part of the request itself.
import { createSignal, Show } from 'solid-js'
import { Button, Field, Input, Modal, Select } from '@acorn/plugin-api/ui'

export type SaveTarget = { name: string; folder: string; scope: 'task' | 'project' }

export default function SaveRequestModal(props: {
  target: SaveTarget
  /** Mounted as a task pane, so "keep with this task" is on offer at all. */
  inTask: boolean
  /** Folders already in use in this repo, offered as completions, not as a closed list. */
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
            maxLength={120}
            placeholder="List users"
            ref={(el) => queueMicrotask(() => el.select())}
            onInput={(value) => setName(value)}
          />
        </Field>

        <Show when={props.inTask}>
          <Field label="Keep in" hint={scope() === 'task' ? 'Stays with this task and goes when the task does.' : "Filed in the project's tree, available from every task."}>
            <Select value={scope()} onChange={(value) => setScope(value as 'task' | 'project')} options={[{ value: 'task', label: 'This task' }, { value: 'project', label: 'The project' }]} />
          </Field>
        </Show>

        {/* Suggestions, not a picker: existing folders are offered and a new path is just typed. */}
        <Show when={scope() === 'project'}>
          <Field label="Folder" hint="Slash-separated. Leave blank for the top of the tree.">
            <Input
              value={folder()}
              suggestions={props.folders}
              placeholder="auth/admin"
              assist={false}
              onInput={(value) => setFolder(value)}
            />
          </Field>
        </Show>

        <Show when={props.error}>
          <p class="http-response-error" role="alert">{props.error}</p>
        </Show>
      </Modal.Body>

      <Modal.Actions>
        <Button variant="ghost" onPress={props.onClose}>Cancel</Button>
        <Button variant="solid" tone="accent" busy={props.busy} disabled={!name().trim()} onPress={submit}>
          Save
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
