import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { toast, type Task } from '@acorn/plugin-api/client'
import { memoryApi, type MemoryType } from './memoryClient'
import { Alert, Button, Select, Textarea } from '@acorn/plugin-api/ui'
import './memory-section.css'

const MEMORY_TYPE_OPTIONS: MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

// The memory surfaces of the Manifest pane (docs/agent-tools.md), kept as a child in the memory plugin
// so it owns every memoryApi() call. Two things: the human gate over auto-generated proposals, where
// accept (with an optional description edit) writes to the task worktree and index and reject leaves no
// trace, and the manual "+ memory" form, where project scope goes to the task worktree and lands via
// its PR while private scope goes to ~/.acorn/memory.
//
// `onChanged` lets the host refresh its assembled-context view after a write; `onPendingChange`
// surfaces the pending-proposal count on the Manifest's memory section row.
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
    <>
      <Show when={proposalError()}><Alert>{proposalError()}</Alert></Show>
      <Show when={(proposals() ?? []).length}>
        <div class="memory-proposals">
          <span class="muted">Memory proposals (auto-generated — review before they land):</span>
          <For each={proposals() ?? []}>
            {(p) => (
              <>
                <div class="memory-proposal">
                  <span class="context-tray-kind">{p.type}</span>
                  <span class="context-tray-label" title={p.body}>{p.name}</span>
                  <input
                    class="ui-input memory-proposal-desc"
                    type="text"
                    value={propEdits()[p.id] ?? p.description}
                    onInput={(e) => setPropEdits((prev) => ({ ...prev, [p.id]: e.currentTarget.value }))}
                  />
                  <Button onClick={() => void resolveProposal(p.id, true)}>Accept</Button>
                  <Button onClick={() => void resolveProposal(p.id, false)}>Reject</Button>
                </div>
                {/* Verification flags (structural `flags`, docs/notes-and-memory.md): shown as warning badges
                    beside the proposal, never folded into the description text. */}
                <Show when={p.flags.length}>
                  <div class="memory-proposal-flags">
                    <For each={p.flags}>{(f) => <span class="memory-proposal-flag">⚠ {f}</span>}</For>
                  </div>
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show when={memoryApi()}>
        <div class="memory-section-actions">
          <Button onClick={() => setMemFormOpen(!memFormOpen())}>+ memory</Button>
          <Show when={memMsg()}>{(msg) => <Alert>{msg()}</Alert>}</Show>
        </div>
      </Show>
      <Show when={memFormOpen()}>
        <form
          class="memory-section-form"
          onSubmit={(e) => {
            e.preventDefault()
            void addMemory()
          }}
        >
          <div class="integration-key-row">
            <input class="ui-input" type="text" placeholder="name (kebab-case)" value={memName()} onInput={(e) => setMemName(e.currentTarget.value)} />
            <Select value={memType()} onChange={(e) => setMemType(e.currentTarget.value as MemoryType)}>
              <For each={MEMORY_TYPE_OPTIONS}>{(k) => <option value={k}>{k}</option>}</For>
            </Select>
            <Select value={memScope()} onChange={(e) => setMemScope(e.currentTarget.value as 'project' | 'private')}>
              <option value="project">project (worktree, committed)</option>
              <option value="private">private (~/.acorn)</option>
            </Select>
          </div>
          <input class="ui-input" type="text" placeholder="one-line description" value={memDesc()} onInput={(e) => setMemDesc(e.currentTarget.value)} />
          <Textarea mono rows="3" placeholder={'Body — include a **Why:** line.'} value={memBody()} onInput={(e) => setMemBody(e.currentTarget.value)} />
          <div class="memory-section-actions">
            <Button type="submit" disabled={!memName().trim() || !memDesc().trim()}>Save memory</Button>
          </div>
        </form>
      </Show>
    </>
  )
}
