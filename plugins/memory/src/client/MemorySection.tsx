import { createEffect, createResource, createSignal, Show } from 'solid-js'
import { toast, type Task } from '@acorn/plugin-api/client'
import { memoryApi, type MemoryType } from './memoryClient'
import ProposalList from './ProposalList'
import { Alert, Button, Card, Field, Inline, Input, Select, Stack, Text, Textarea, Toolbar } from '@acorn/plugin-api/ui'

const MEMORY_TYPE_OPTIONS: MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

// The memory surfaces of the Context pane (docs/agent-tools.md), kept in the memory plugin so it owns
// every memoryApi() call. Two things: the human gate over auto-generated proposals, where accept (with
// an optional description edit) writes the file and index and reject leaves no trace, and the manual
// "+ memory" form. Both scopes write under ~/.acorn/memory and never into the repo, so the choice is
// about reach: project scope applies to this project alone, private scope everywhere.
//
// This is a contribution to `context:section`, so context does not import it and memory does not import
// context's pane: the host carries the props and draws whichever of the two render paths this happens
// to be on. `onChanged` lets the owner refresh its assembled-context view after a write;
// `onPendingChange` surfaces the pending-proposal count on the section's own header.
export default function MemorySection(props: {
  task: Task
  onChanged: () => void
  onPendingChange?: (count: number) => void
}) {
  const [proposals, { refetch: refetchProposals }] = createResource(
    () => props.task.id,
    async (id) => (memoryApi() ? await memoryApi()!.proposals(id) : []),
    { initialValue: [] },
  )
  createEffect(() => props.onPendingChange?.((proposals() ?? []).length))

  const [memFormOpen, setMemFormOpen] = createSignal(false)
  const [memName, setMemName] = createSignal('')
  const [memDesc, setMemDesc] = createSignal('')
  const [memType, setMemType] = createSignal<MemoryType>('convention')
  const [memScope, setMemScope] = createSignal<'project' | 'private'>('project')
  const [memBody, setMemBody] = createSignal('')
  // Only failures live here now. Success and failure used to share one muted grey span, so a failed save
  // read exactly like a successful one. Success is a toast; a failure needs to persist.
  const [memMsg, setMemMsg] = createSignal<string | null>(null)

  async function addMemory() {
    const m = memoryApi()
    if (!m) return
    setMemMsg(null)
    const res = await m.add({
      taskId: props.task.id,
      scope: memScope(),
      name: memName().trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      description: memDesc().trim(),
      type: memType(),
      body: memBody(),
    })
    if ('error' in res) return setMemMsg(res.error)
    toast(`Saved → ${res.path}`, { tone: 'success' })
    setMemName('')
    setMemDesc('')
    setMemBody('')
    props.onChanged()
  }

  return (
    <Stack gap="row">
      <Show when={(proposals() ?? []).length}>
        <Stack gap="row">
          <Text emphasis="muted">Memory proposals for this task. Every pending proposal is on the Memory page.</Text>
          <ProposalList
            proposals={proposals() ?? []}
            onResolved={() => {
              void refetchProposals()
              props.onChanged()
            }}
          />
        </Stack>
      </Show>
      <Show when={memoryApi()}>
        <Toolbar variant="actions" size="sm">
          <Button size="sm" onPress={() => setMemFormOpen(!memFormOpen())} expanded={memFormOpen()}>+ memory</Button>
        </Toolbar>
      </Show>
      <Show when={memMsg()}>{(msg) => <Alert>{msg()}</Alert>}</Show>
      <Show when={memFormOpen()}>
        <Card>
          <Stack gap="row">
            <Inline gap="inline" wrap>
              <Field label="Name" hint="kebab-case">
                <Input value={memName()} placeholder="name" onInput={(value) => setMemName(value)} />
              </Field>
              <Field label="Type">
                <Select value={memType()} onChange={(value) => setMemType(value as MemoryType)} options={MEMORY_TYPE_OPTIONS.map((k) => ({ value: k, label: k }))} />
              </Field>
              <Field label="Scope">
                <Select
                  value={memScope()}
                  onChange={(value) => setMemScope(value as 'project' | 'private')}
                  options={[{ value: 'project', label: 'project (this project only)' }, { value: 'private', label: 'private (every project)' }]}
                />
              </Field>
            </Inline>
            <Field label="Description">
              <Input value={memDesc()} placeholder="one-line description" onInput={(value) => setMemDesc(value)} />
            </Field>
            <Field label="Body">
              <Textarea mono rows={3} placeholder={'Body — include a **Why:** line.'} value={memBody()} onInput={(value) => setMemBody(value)} />
            </Field>
            <Toolbar variant="actions" size="sm">
              <Button size="sm" disabled={!memName().trim() || !memDesc().trim()} onPress={() => void addMemory()}>Save memory</Button>
            </Toolbar>
          </Stack>
        </Card>
      </Show>
    </Stack>
  )
}
