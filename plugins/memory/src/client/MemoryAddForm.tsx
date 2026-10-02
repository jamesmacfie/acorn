import { createSignal, Show } from 'solid-js'
import { toast, type Task } from '@acorn/plugin-api/client'
import { MEMORY_SCOPE_OPTIONS, MEMORY_TYPE_OPTIONS, memoryApi, type MemoryType } from './memoryClient'
import { Alert, Button, Card, Field, Icon, Inline, Input, Select, Stack, Textarea, Toolbar } from '@acorn/plugin-api/ui'

// Owner additions use the same guarded file store as agent writes.
export default function MemoryAddForm(props: {
  task?: Task
  projectId?: string
  onChanged: () => void
}) {
  const [memFormOpen, setMemFormOpen] = createSignal(false)
  const [memName, setMemName] = createSignal('')
  const [memDesc, setMemDesc] = createSignal('')
  const [memType, setMemType] = createSignal<MemoryType>('project')
  const [memScope, setMemScope] = createSignal<'project' | 'private'>('project')
  const [memBody, setMemBody] = createSignal('')
  // Only failures live here now. Success and failure used to share one muted grey span, so a failed save
  // read exactly like a successful one. Success is a toast; a failure needs to persist.
  const [memMsg, setMemMsg] = createSignal<string | null>(null)

  const [saving, setSaving] = createSignal(false)

  async function addMemory() {
    const m = memoryApi()
    if (!m) return
    setMemMsg(null)
    setSaving(true)
    try {
      const res = await m.add({
        taskId: props.task?.id,
        projectId: props.projectId,
        scope: memScope(),
        name: memName().trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
        description: memDesc().trim(),
        type: memType(),
        body: memBody(),
      })
      if ('error' in res) return setMemMsg(res.error)
      toast('Memory saved', { tone: 'success' })
      clear()
      props.onChanged()
    } catch (error) {
      setMemMsg(error instanceof Error ? error.message : 'Could not save memory.')
    } finally {
      setSaving(false)
    }
  }

  function clear() {
    setMemName('')
    setMemDesc('')
    setMemBody('')
  }

  return (
    <Stack gap="row">
      <Show when={memoryApi()}>
        <Toolbar variant="actions" size="sm">
          <Button size="sm" onPress={() => setMemFormOpen(!memFormOpen())} expanded={memFormOpen()}><Icon name="plus" /> Add memory</Button>
        </Toolbar>
      </Show>
      <Show when={memMsg()}>{(msg) => <Alert>{msg()}</Alert>}</Show>
      <Show when={memFormOpen()}>
        {/* A boxed page form: the fields stacked, then the solid primary and a ghost Cancel on the left.
            The name needs no format hint, because addMemory makes it file-safe itself. */}
        <Card>
          <Stack gap="stack">
            <Field label="Name">
              <Input value={memName()} onInput={(value) => setMemName(value)} />
            </Field>
            <Inline even>
              <Field label="Type">
                <Select value={memType()} onChange={(value) => setMemType(value as MemoryType)} options={MEMORY_TYPE_OPTIONS} />
              </Field>
              <Field label="Scope">
                <Select value={memScope()} onChange={(value) => setMemScope(value as 'project' | 'private')} options={MEMORY_SCOPE_OPTIONS} />
              </Field>
            </Inline>
            <Field label="Description">
              <Input value={memDesc()} placeholder="What the agent should know, in one line" onInput={(value) => setMemDesc(value)} />
            </Field>
            <Field label="Body">
              <Textarea mono rows={3} placeholder="The details. Say why, so the agent knows when it applies." value={memBody()} onInput={(value) => setMemBody(value)} />
            </Field>
            <Inline gap="row">
              <Button variant="solid" disabled={saving() || !memName().trim() || !memDesc().trim()} onPress={() => void addMemory()}>Save memory</Button>
              <Button variant="ghost" onPress={() => { clear(); setMemFormOpen(false) }}>Cancel</Button>
            </Inline>
          </Stack>
        </Card>
      </Show>
    </Stack>
  )
}
