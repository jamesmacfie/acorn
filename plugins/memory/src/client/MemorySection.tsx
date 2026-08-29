import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { toast, type Task } from '@acorn/plugin-api/client'
import { memoryApi, type MemoryType } from './memoryClient'
import { Alert, Badge, Button, Card, Field, Inline, Input, Select, Stack, Text, Textarea, Toolbar } from '@acorn/plugin-api/ui'

const MEMORY_TYPE_OPTIONS: MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

// The memory surfaces of the Context pane (docs/agent-tools.md), kept in the memory plugin so it owns
// every memoryApi() call. Two things: the human gate over auto-generated proposals, where accept (with
// an optional description edit) writes to the task worktree and index and reject leaves no trace, and
// the manual "+ memory" form, where project scope goes to the task worktree and lands via its PR while
// private scope goes to ~/.acorn/memory.
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
  const [propEdits, setPropEdits] = createSignal<Record<string, string>>({})
  const [proposalError, setProposalError] = createSignal('')

  async function resolveProposal(id: string, approved: boolean) {
    const m = memoryApi()
    if (!m) return
    const p = (proposals() ?? []).find((x) => x.id === id)
    const editedDesc = propEdits()[id]
    const res = await m.resolveProposal(
      id,
      approved,
      approved && p && editedDesc && editedDesc !== p.description ? { name: p.name, type: p.type, description: editedDesc, body: p.body } : undefined,
    )
    if (!res.ok && res.reason) setProposalError(res.reason)
    else setProposalError('')
    await refetchProposals()
    props.onChanged()
  }

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
      <Show when={proposalError()}>{(text) => <Alert>{text()}</Alert>}</Show>
      <Show when={(proposals() ?? []).length}>
        <Stack gap="row">
          <Text emphasis="muted">Memory proposals (auto-generated — review before they land):</Text>
          <For each={proposals() ?? []}>
            {(p) => (
              <Card>
                <Stack gap="row">
                  <Inline gap="inline" wrap>
                    <Text emphasis="muted">{p.type}</Text>
                    <Text emphasis="strong">{p.name}</Text>
                  </Inline>
                  <Input
                    label={`Description for ${p.name}`}
                    value={propEdits()[p.id] ?? p.description}
                    onInput={(value) => setPropEdits((prev) => ({ ...prev, [p.id]: value }))}
                  />
                  {/* Verification flags (structural `flags`, docs/notes-and-memory.md): warning badges
                      beside the proposal, never folded into the description text. */}
                  <Show when={p.flags.length}>
                    <Inline gap="inline" wrap>
                      <For each={p.flags}>{(flag) => <Badge tone="warn" shape="pill">⚠ {flag}</Badge>}</For>
                    </Inline>
                  </Show>
                  <Toolbar variant="actions" size="sm">
                    <Button size="sm" onPress={() => void resolveProposal(p.id, true)}>Accept</Button>
                    <Button size="sm" onPress={() => void resolveProposal(p.id, false)}>Reject</Button>
                  </Toolbar>
                </Stack>
              </Card>
            )}
          </For>
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
                  options={[{ value: 'project', label: 'project (worktree, committed)' }, { value: 'private', label: 'private (~/.acorn)' }]}
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
