import { createSignal, For, onMount, Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import type { Task, TaskSeed } from '@acorn/protocol/api.ts'
import { projectsOptions } from '../queries'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import { sourceRegistry } from '../registries/sources'
import { Tabs } from '../ui/Tabs'
import { createDismissable } from '../ui/dismissable'
import { Alert, Button, Select } from '../ui/primitives'

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
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const github = () => project()?.github
  const promotion = () => {
    const source = sourceRegistry.get(props.providerId)
    // A source with no promotion cannot be promoted through this modal, and nothing opens it for one — the
    // rail's promote affordance is rendered by each browse surface. Throwing names the real mistake rather
    // than failing later on `undefined.prepare`.
    if (!source?.promotion) throw new Error(`No promotable source registered for provider '${props.providerId}'`)
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
    const projectId = params.projectId
    if (!projectId) return
    void Promise.resolve(promotion().prepare(props.item, { projectId, owner: github()?.owner ?? '', repo: github()?.name ?? '', branch: '', existingBranches: props.existingBranches }))
      .then((seed) => {
        setTitle(seed.title ?? '')
        setBranch(seed.branch ?? '')
      })
      .catch(() => {})
  })

  const canAttach = () => typeof promotion().attachToCurrentTask === 'function' && props.attachTasks.length > 0

  async function submitNew(e: Event) {
    e.preventDefault()
    const projectId = params.projectId
    const isGitProject = project()?.vcs === 'git'
    const b = slugifyBranch(branch())
    if (!projectId || !title().trim() || (isGitProject && !b)) return
    setBusy(true)
    setError('')
    try {
      const context = { projectId, owner: github()?.owner ?? '', repo: github()?.name ?? '', branch: isGitProject ? b : undefined, existingBranches: props.existingBranches }
      const base = await Promise.resolve(promotion().prepare(props.item, context))
      const seed: TaskSeed = isGitProject
        ? { ...base, title: title().trim(), branch: b }
        : { ...base, title: title().trim(), branch: undefined }
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

  let dialog!: HTMLDivElement
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => dialog })

  const formStyle = { 'flex-direction': 'column', 'align-items': 'stretch', gap: '6px' } as const

  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div ref={dialog} class="overlay" role="dialog" aria-modal="true" onClick={dismiss.onContainerClick} onKeyDown={dismiss.onKeyDown}>
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
          <Show when={error()}><Alert>{error()}</Alert></Show>

          <Show when={mode() === 'new'}>
            <form id="promote-panel-new" role="tabpanel" class="integration-key-row" style={formStyle} onSubmit={submitNew}>
              <p class="muted">New task in {project()?.name ?? 'this project'}.</p>
              <input class="ui-input" type="text" placeholder="Task title" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
              <Show when={project()?.vcs === 'git'}>
                <input class="ui-input" type="text" placeholder="branch" value={branch()} onInput={(e) => setBranch(e.currentTarget.value)} />
              </Show>
              <div class="close-actions">
                <Button onClick={props.onClose}>Cancel</Button>
                <Button type="submit" disabled={busy() || !title().trim() || (project()?.vcs === 'git' && !slugifyBranch(branch()))}>Create task</Button>
              </div>
            </form>
          </Show>

          <Show when={mode() === 'attach'}>
            <form id="promote-panel-attach" role="tabpanel" class="integration-key-row" style={formStyle} onSubmit={submitAttach}>
              <p class="muted">Attach this item to an existing task.</p>
              <Select value={attachId()} onChange={(e) => setAttachId(e.currentTarget.value)}>
                <For each={props.attachTasks}>{(t) => <option value={t.id}>{t.title} · {t.branch}</option>}</For>
              </Select>
              <div class="close-actions">
                <Button onClick={props.onClose}>Cancel</Button>
                <Button type="submit" disabled={busy() || !attachId()}>Attach</Button>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </div>
  )
}
