import { createSignal, onCleanup, Show } from 'solid-js'
import type { Task } from '@acorn/plugin-api/client'
import { MEMORY_TYPE_OPTIONS, memoryApi, type MemoryType } from './memoryClient'
import { memoriesChanged, selectMemory, setAddingMemory } from './memorySelection'
import { Alert, Button, Field, Heading, Inline, Input, Select, Stack, Textarea, Toolbar } from '@acorn/plugin-api/ui'

// Owner additions use the same guarded file store as agent writes. A page form in the detail column:
// the fields, any error, then the solid primary and a ghost Cancel on the left. The name needs no
// format hint, because save() makes it file-safe itself.
export default function MemoryAddForm(props: { task?: Task; projectId: string }) {
  let active = true
  onCleanup(() => { active = false })
  const [name, setName] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [type, setType] = createSignal<MemoryType>('project')
  const [body, setBody] = createSignal('')
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)

  async function save() {
    setError('')
    setSaving(true)
    const fileName = name().trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
    try {
      const result = await memoryApi().add({
        taskId: props.task?.id,
        projectId: props.projectId,
        scope: 'project',
        name: fileName,
        description: description().trim(),
        type: type(),
        body: body(),
      })
      if ('error' in result) return setError(result.error)
      memoriesChanged()
      // The saved memory opens in its reader, which is the confirmation.
      if (active) selectMemory({ name: fileName, scope: 'project', projectId: props.projectId })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the memory.")
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Toolbar ariaLabel="New memory"><Heading level={2}>New memory</Heading></Toolbar>
    <Stack gap="stack">
      <Field label="Name"><Input value={name()} onInput={setName} /></Field>
      <Field label="Description">
        <Input value={description()} placeholder="What the agent should know, in one line" onInput={setDescription} />
      </Field>
      <Field label="Type"><Select value={type()} onChange={(value) => setType(value as MemoryType)} options={MEMORY_TYPE_OPTIONS} /></Field>
      <Field label="Body">
        <Textarea mono rows={12} placeholder="The details. Say why, so the agent knows when it applies." value={body()} onInput={setBody} />
      </Field>
      <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Inline gap="row">
        <Button variant="solid" disabled={saving() || !name().trim() || !description().trim()} onPress={() => void save()}>Save memory</Button>
        <Button variant="ghost" onPress={() => setAddingMemory(undefined)}>Cancel</Button>
      </Inline>
    </Stack>
  </>
}
