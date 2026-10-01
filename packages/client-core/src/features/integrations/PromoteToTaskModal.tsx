import { Portal } from 'solid-js/web'
import { createResource, createSignal, onMount, Show, type JSX } from 'solid-js'
import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import type { Task, TaskSeed } from '@acorn/protocol/api.ts'
import { projectsOptions } from '../../infra/queries'
import { isValidBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { Tabs } from '../../kit/components/layout/Tabs'
import { createDismissable } from '../../kit/lib/controls/dismissable'
import { Alert, Button, Checkbox, Input, Select } from '../../kit/components/primitives'
import { taskBridge } from '../tasks/taskBridge'
import { defaultBranchForTask } from '../tasks/defaultBranch'

/** A feature-owned action rendered and run after the source has made or attached a task. */
export type PromoteTaskAction = {
  content: JSX.Element
  ready: () => boolean
  label: string
  onTaskReady: (task: Task) => Promise<void>
}

// Shared "+ Task" flow for the integration browses. Promoting an external item (a Rollbar error, a
// Linear ticket) either creates a new task or attaches the item to an existing one: a task
// references many external items (task_links is a bag, not a scalar). When open tasks exist we tab
// between the two; the default is always a new task. The create/attach mechanics come from the
// provider's registered `promotion` contract, so this component is provider-agnostic.
export function PromoteToTaskModal(props: {
  providerId: string
  item: unknown
  itemTitle: string
  headerLabel: string
  attachTasks: Task[] // active tasks in scope, eligible to attach to
  existingBranches: string[]
  /** Optional owner action after the task is created or attached. */
  action?: PromoteTaskAction
  onClose: () => void
  onCreated: (task: Task) => void
  onAttached: (task: Task) => void
}) {
  const params = useParams()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const github = () => project()?.github
  const [projectConfig] = createResource(
    () => (project()?.vcs === 'git' ? project()?.id : undefined),
    (projectId) => taskBridge().project.get(projectId),
  )
  const branchPrefix = () => projectConfig()?.config.branchPrefix ?? null
  const promotion = () => {
    const source = sourceRegistry.get(props.providerId)
    // A source with no promotion cannot be promoted through this modal, and nothing opens it for
    // one: the rail's promote affordance is rendered by each browse surface. Throwing names the
    // real mistake rather than failing later on `undefined.prepare`.
    if (!source?.promotion) throw new Error(`No promotable source registered for provider '${props.providerId}'`)
    return source.promotion
  }

  const [mode, setMode] = createSignal<'new' | 'attach'>('new')
  const [title, setTitle] = createSignal('')
  const [branch, setBranch] = createSignal('')
  const [branchTouched, setBranchTouched] = createSignal(false)
  const [skipSetup, setSkipSetup] = createSignal(false)
  const [attachId, setAttachId] = createSignal(props.attachTasks[0]?.id ?? '')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  // A failed follow-up action keeps the task here, so retry cannot create or attach it twice.
  const [prepared, setPrepared] = createSignal<{ mode: 'new' | 'attach'; task: Task; linked: boolean } | null>(null)

  const finish = async (task: Task, done: (task: Task) => void): Promise<void> => {
    try {
      await props.action?.onTaskReady(task)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The task is ready, but the action failed.')
      setBusy(false)
      return
    }
    done(task)
  }

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

  // The branch the task is actually made on. A name the provider seeded is used verbatim: a pull
  // request's head branch already exists on the remote, and slugging it away gave the task a local
  // branch that could never be pushed to that pull request ('npm_and_yarn' became 'npm-and-yarn').
  // With no provider seed, the title supplies the same prefixed, de-duplicated default as the rail's
  // local-task dialog. Only what a person types in the branch field is slugged. Either way an
  // unusable name leaves the button disabled.
  const defaultBranch = () => defaultBranchForTask(title(), branchPrefix(), props.existingBranches)
  const effectiveBranch = () => {
    if (branchTouched()) return slugifyBranch(branch())
    const seeded = branch().trim()
    return seeded ? (isValidBranch(seeded) ? seeded : '') : defaultBranch()
  }

  const canAttach = () => typeof promotion().attachToCurrentTask === 'function' && props.attachTasks.length > 0

  async function submitNew(e: Event) {
    e.preventDefault()
    const projectId = params.projectId
    const isGitProject = project()?.vcs === 'git'
    const b = effectiveBranch()
    if (!projectId || (props.action && !props.action.ready())) return
    const retry = prepared()
    if ((!retry && (!title().trim() || (isGitProject && !b))) || (retry && retry.mode !== 'new')) return
    setBusy(true)
    setError('')
    try {
      const context = { projectId, owner: github()?.owner ?? '', repo: github()?.name ?? '', branch: isGitProject ? b : undefined, existingBranches: props.existingBranches }
      let current = retry
      if (!current) {
        const base = await Promise.resolve(promotion().prepare(props.item, context))
        const seed: TaskSeed = isGitProject
          ? { ...base, title: title().trim(), branch: b, skipSetup: skipSetup() }
          : { ...base, title: title().trim(), branch: undefined }
        const task = await promotion().create(seed)
        current = { mode: 'new', task, linked: false }
        setPrepared(current)
      }
      if (!current.linked) {
        await promotion().afterCreate?.(current.task, props.item, context)
        current = { ...current, linked: true }
        setPrepared(current)
      }
      await finish(current.task, props.onCreated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the task.')
      setBusy(false)
    }
  }

  async function submitAttach(e: Event) {
    e.preventDefault()
    const attach = promotion().attachToCurrentTask
    const task = props.attachTasks.find((t) => t.id === attachId())
    if (props.action && !props.action.ready()) return
    const retry = prepared()
    if ((!retry && (!attach || !task)) || (retry && retry.mode !== 'attach')) return
    setBusy(true)
    setError('')
    try {
      if (!retry) {
        await attach!(task!.id, props.item)
        setPrepared({ mode: 'attach', task: task!, linked: true })
      }
      await finish((retry?.task ?? task)!, props.onAttached)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach to the task.')
      setBusy(false)
    }
  }

  let dialog!: HTMLDivElement
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => dialog })

  const formStyle = { 'flex-direction': 'column', 'align-items': 'stretch', gap: '6px' } as const

  return (
    <Portal>
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div ref={dialog} class="overlay" role="dialog" aria-modal="true" onClick={dismiss.onContainerClick} onKeyDown={dismiss.onKeyDown}>
        <div class="overlay-title">{props.headerLabel}</div>
        <Show when={props.action}>{(action) => <div class="overlay-body">{action().content}</div>}</Show>
        <Show when={canAttach() && !prepared()}>
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
              <Input placeholder="Task title" value={title()} disabled={!!prepared()} onInput={(value) => setTitle(value)} />
              <Show when={project()?.vcs === 'git'}>
                <Input
                  placeholder="branch (from title)"
                  title="Branch name — defaults to a slug of the title"
                  value={branchTouched() || branch().trim() ? branch() : defaultBranch()}
                  disabled={!!prepared()}
                  onInput={(value) => {
                    setBranch(value)
                    setBranchTouched(true)
                  }}
                />
                <Checkbox
                  size="sm"
                  label="Skip setup script"
                  title="Do not run this project's setup script for this task"
                  checked={skipSetup()}
                  disabled={!!prepared()}
                  onChange={setSkipSetup}
                />
              </Show>
              <div class="close-actions">
                <Button onPress={props.onClose}>Cancel</Button>
                <Button submit disabled={busy() || (props.action ? !props.action.ready() : false) || (!prepared() && (!title().trim() || (project()?.vcs === 'git' && !effectiveBranch())))}>
                  {prepared() ? `Retry ${props.action?.label ?? 'action'}` : props.action ? `Create & ${props.action.label}` : 'Create task'}
                </Button>
              </div>
            </form>
          </Show>

          <Show when={mode() === 'attach'}>
            <form id="promote-panel-attach" role="tabpanel" class="integration-key-row" style={formStyle} onSubmit={submitAttach}>
              <p class="muted">Attach this item to an existing task.</p>
              <Select
                value={attachId()}
                options={props.attachTasks.map((task) => ({ value: task.id, label: `${task.title} · ${task.branch}` }))}
                onChange={(value) => setAttachId(value)}
              />
              <div class="close-actions">
                <Button onPress={props.onClose}>Cancel</Button>
                <Button submit disabled={busy() || (props.action ? !props.action.ready() : false) || (!prepared() && !attachId())}>
                  {prepared() ? `Retry ${props.action?.label ?? 'action'}` : props.action ? `Attach & ${props.action.label}` : 'Attach'}
                </Button>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </div>
    </Portal>
  )
}
