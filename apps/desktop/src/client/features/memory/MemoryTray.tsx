import { createResource, createSignal, For, Show } from 'solid-js'
import type { Task } from '../../queries'
import { memoryApi, type MemoryType } from './memoryClient'

const MEMORY_TYPE_OPTIONS: MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

// The memory surfaces of the Context pane (docs/next 12), extracted so the pane keeps one job
// (context assembly/send): the human gate over auto-generated proposals — accept (with an optional
// description edit) writes to the task worktree + index, reject leaves no trace — and the manual
// "+ memory" form (repo scope → the task worktree, lands via its PR; private scope →
// ~/.acorn/memory). `onChanged` lets the host refresh its assembled-context view after a write.
export default function MemoryTray(props: { task: Task; onChanged: () => void }) {
  const [proposals, { refetch: refetchProposals }] = createResource(
    () => props.task.id,
    async (id) => (memoryApi() ? await memoryApi()!.proposals(id) : []),
    { initialValue: [] },
  )
  const [propEdits, setPropEdits] = createSignal<Record<string, string>>({})

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
    if (!res.ok && res.reason) window.alert(res.reason)
    await refetchProposals()
    props.onChanged()
  }

  const [memFormOpen, setMemFormOpen] = createSignal(false)
  const [memName, setMemName] = createSignal('')
  const [memDesc, setMemDesc] = createSignal('')
  const [memType, setMemType] = createSignal<MemoryType>('convention')
  const [memScope, setMemScope] = createSignal<'repo' | 'private'>('repo')
  const [memBody, setMemBody] = createSignal('')
  const [memMsg, setMemMsg] = createSignal('')

  async function addMemory() {
    const m = memoryApi()
    if (!m) return
    setMemMsg('')
    const res = await m.add({
      taskId: props.task.id,
      scope: memScope(),
      name: memName().trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      description: memDesc().trim(),
      type: memType(),
      body: memBody(),
    })
    if ('error' in res) return setMemMsg(res.error)
    setMemMsg(`Saved → ${res.path}`)
    setMemName('')
    setMemDesc('')
    setMemBody('')
    props.onChanged()
  }

  return (
    <>
      <Show when={(proposals() ?? []).length}>
        <div class="context-tray-proposals">
          <span class="muted">Memory proposals (auto-generated — review before they land):</span>
          <For each={proposals() ?? []}>
            {(p) => (
              <>
                <div class="context-tray-proposal">
                  <span class="context-tray-kind">{p.type}</span>
                  <span class="context-tray-label" title={p.body}>{p.name}</span>
                  <input
                    class="integration-key-input context-tray-proposal-desc"
                    type="text"
                    value={propEdits()[p.id] ?? p.description}
                    onInput={(e) => setPropEdits((prev) => ({ ...prev, [p.id]: e.currentTarget.value }))}
                  />
                  <button type="button" class="overlay-btn" onClick={() => void resolveProposal(p.id, true)}>Accept</button>
                  <button type="button" class="overlay-btn" onClick={() => void resolveProposal(p.id, false)}>Reject</button>
                </div>
                {/* Verification flags (structural `flags`, docs/next 12): shown as warning badges
                    beside the proposal, never folded into the description text. */}
                <Show when={p.flags.length}>
                  <div class="context-tray-proposal-flags">
                    <For each={p.flags}>{(f) => <span class="context-tray-proposal-flag">⚠ {f}</span>}</For>
                  </div>
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show when={memoryApi()}>
        <div class="context-tray-actions">
          <button type="button" class="overlay-btn" onClick={() => setMemFormOpen(!memFormOpen())}>+ memory</button>
          <Show when={memMsg()}><span class="muted">{memMsg()}</span></Show>
        </div>
      </Show>
      <Show when={memFormOpen()}>
        <form
          class="context-tray-memform"
          onSubmit={(e) => {
            e.preventDefault()
            void addMemory()
          }}
        >
          <div class="integration-key-row">
            <input class="integration-key-input" type="text" placeholder="name (kebab-case)" value={memName()} onInput={(e) => setMemName(e.currentTarget.value)} />
            <select class="integration-key-input" value={memType()} onChange={(e) => setMemType(e.currentTarget.value as MemoryType)}>
              <For each={MEMORY_TYPE_OPTIONS}>{(k) => <option value={k}>{k}</option>}</For>
            </select>
            <select class="integration-key-input" value={memScope()} onChange={(e) => setMemScope(e.currentTarget.value as 'repo' | 'private')}>
              <option value="repo">repo (worktree, committed)</option>
              <option value="private">private (~/.acorn)</option>
            </select>
          </div>
          <input class="integration-key-input" type="text" placeholder="one-line description" value={memDesc()} onInput={(e) => setMemDesc(e.currentTarget.value)} />
          <textarea class="settings-script" rows="3" placeholder={'Body — include a **Why:** line.'} value={memBody()} onInput={(e) => setMemBody(e.currentTarget.value)} />
          <div class="context-tray-actions">
            <button type="submit" class="overlay-btn" disabled={!memName().trim() || !memDesc().trim()}>Save memory</button>
          </div>
        </form>
      </Show>
    </>
  )
}
