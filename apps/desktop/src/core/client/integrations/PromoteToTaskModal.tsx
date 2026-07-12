import { createSignal, For, onMount, Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import type { Task, TaskSeed } from '../../shared/api'
import { slugifyBranch } from '../../shared/branch'
import { sourceRegistry } from '../registries/sources'
import { Tabs } from '../ui/Tabs'

// Shared "+TASK" flow for the integration browses (docs/workspaces-and-tasks.md). Promoting an
// external item (a Rollbar error, a Linear ticket) either CREATES a new task or ATTACHES the item to
// an existing one — a task references many external items (task_links is a bag, not a scalar). When
// open tasks exist we tab between the two; the default is always a new task. The create/attach
// mechanics come from the provider's registered `promotion` contract, so this component is
// provider-agnostic.
export function PromoteToTaskModal(props: {
  providerId: string
  item: unknown
  itemTitle: string
  headerLabel: string
  attachTasks: Task[] // active tasks in scope, eligible to attach to
  existingBranches: string[]
  onClose: () => void
  onCreated: (task: Task) => void
  onAttached: (task: Task) => void
}) {
  const params = useParams()
  const promotion = () => {
    const source = sourceRegistry.get(props.providerId)
    if (!source) throw new Error(`No source registered for provider '${props.providerId}'`)
    return source.promotion
  }

  const [mode, setMode] = createSignal<'new' | 'attach'>('new')
  const [title, setTitle] = createSignal('')
  const [branch, setBranch] = createSignal('')
  const [attachId, setAttachId] = createSignal(props.attachTasks[0]?.id ?? '')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  // Prefill title/branch from the provider's own seed derivation (branch omitted so it derives a
  // default). Both current providers are synchronous; resolve defensively in case one isn't.
  onMount(() => {
    void Promise.resolve(promotion().prepare(props.item, { owner: params.owner ?? '', repo: params.repo ?? '', branch: '', existingBranches: props.existingBranches }))
      .then((seed) => {
        setTitle(seed.title ?? '')
        setBranch(seed.branch)
      })
      .catch(() => {})
  })

  const canAttach = () => typeof promotion().attachToCurrentTask === 'function' && props.attachTasks.length > 0

  async function submitNew(e: Event) {
    e.preventDefault()
    const { owner, repo } = params
    const b = slugifyBranch(branch())
    if (!owner || !repo || !title().trim() || !b) return
    setBusy(true)
    setError('')
    try {
      const context = { owner, repo, branch: b, existingBranches: props.existingBranches }
      const base = await Promise.resolve(promotion().prepare(props.item, context))
      const seed: TaskSeed = { ...base, title: title().trim(), branch: b }
      const task = await promotion().create(seed)
      await promotion().afterCreate?.(task, props.item, context)
      props.onCreated(task)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the task.')
      setBusy(false)
    }
  }

  async function submitAttach(e: Event) {
    e.preventDefault()
    const attach = promotion().attachToCurrentTask
    const task = props.attachTasks.find((t) => t.id === attachId())
    if (!attach || !task) return
    setBusy(true)
    setError('')
    try {
      await attach(task.id, props.item)
      props.onAttached(task)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach to the task.')
      setBusy(false)
    }
  }

  const formStyle = { 'flex-direction': 'column', 'align-items': 'stretch', gap: '6px' } as const

  return (
    <div class="overlay-backdrop" onClick={props.onClose}>
      <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div class="overlay-title">{props.headerLabel}</div>
        <Show when={canAttach()}>
          <Tabs
            tabs={[{ id: 'new', label: 'New task' }, { id: 'attach', label: 'Attach to task', count: props.attachTasks.length }]}
            active={mode()}
            onChange={(id) => setMode(id as 'new' | 'attach')}
            idPrefix="promote"
            ariaLabel="Create a task or attach to an existing one"
          />
        </Show>
        <div class="overlay-body">
          <p class="muted">{props.itemTitle}</p>
          <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>

          <Show when={mode() === 'new'}>
            <form id="promote-panel-new" role="tabpanel" class="integration-key-row" style={formStyle} onSubmit={submitNew}>
              <p class="muted">New task in {params.owner}/{params.repo}.</p>
              <input class="integration-key-input" type="text" placeholder="Task title" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
              <input class="integration-key-input" type="text" placeholder="branch" value={branch()} onInput={(e) => setBranch(e.currentTarget.value)} />
              <div class="close-actions">
                <button type="button" class="overlay-btn" onClick={props.onClose}>Cancel</button>
                <button type="submit" class="overlay-btn" disabled={busy() || !title().trim() || !slugifyBranch(branch())}>Create task</button>
              </div>
            </form>
          </Show>

          <Show when={mode() === 'attach'}>
            <form id="promote-panel-attach" role="tabpanel" class="integration-key-row" style={formStyle} onSubmit={submitAttach}>
              <p class="muted">Attach this item to an existing task.</p>
              <select class="integration-key-input" value={attachId()} onChange={(e) => setAttachId(e.currentTarget.value)}>
                <For each={props.attachTasks}>{(t) => <option value={t.id}>{t.title} · {t.branch}</option>}</For>
              </select>
              <div class="close-actions">
                <button type="button" class="overlay-btn" onClick={props.onClose}>Cancel</button>
                <button type="submit" class="overlay-btn" disabled={busy() || !attachId()}>Attach</button>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </div>
  )
}
