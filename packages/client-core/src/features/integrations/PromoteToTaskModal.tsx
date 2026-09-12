import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import type { Task, TaskSeed } from '@acorn/protocol/api.ts'
import type { WorkflowDefSummary } from '@acorn/protocol/workflow.ts'
import { projectsOptions } from '../../infra/queries'
import { isValidBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { Tabs } from '../../kit/components/layout/Tabs'
import { createDismissable } from '../../kit/lib/dismissable'
import { Alert, Button, Field, Input, Select } from '../../kit/components/primitives'
import { taskBridge } from '../tasks/taskBridge'
import { defaultBranchForTask } from '../tasks/defaultBranch'

/**
 * The workflow step, drawn above the tabs when the caller wants one (docs/workflows.md § Starting a
 * run). The modal knows how to pick a definition and collect its inputs; what a definition is and how
 * a run starts stay with the workflows plugin, which passes `onStart`.
 */
export type PromoteWorkflowStep = {
  /** Everything the workspace can run, in the order it should be offered. */
  definitions: readonly WorkflowDefSummary[]
  /** The definition selected when the modal opens. */
  initial?: string
  /** Values the item already supplies, by input name. Editable. */
  prefill?: Readonly<Record<string, string>>
  /** Runs after the task exists. A rejection keeps the modal open with the message. */
  onStart: (taskId: string, defId: string, inputs: Record<string, string>) => Promise<void>
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
  /** Pick a workflow and fill its inputs above the tabs, then run it on the task this modal made or
   *  attached to. Absent for the plain "+ Task" flow. */
  workflow?: PromoteWorkflowStep
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
  const [attachId, setAttachId] = createSignal(props.attachTasks[0]?.id ?? '')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  // ── The workflow step ───────────────────────────────────────────────────────────────────────────
  // Held here rather than in a child, because the primary button's label and its disabled state are
  // the tabs' and the answer depends on both halves.
  const [defId, setDefId] = createSignal(props.workflow?.initial ?? props.workflow?.definitions[0]?.id ?? '')
  const chosen = createMemo(() => props.workflow?.definitions.find((entry) => entry.id === defId()))
  const workflowInputs = () => chosen()?.inputs ?? []
  const [values, setValues] = createSignal<Record<string, string>>({})
  // What was typed, over what the item and the definition supply. Held by input name, so switching
  // definitions keeps an answer the next one also asks for and re-seeds everything else.
  const seeded = createMemo(() => ({
    ...Object.fromEntries(workflowInputs().filter((input) => input.default).map((input) => [input.name, input.default!])),
    ...Object.fromEntries(workflowInputs()
      .filter((input) => props.workflow?.prefill?.[input.name])
      .map((input) => [input.name, props.workflow!.prefill![input.name]])),
  }))
  const valueOf = (name: string): string => values()[name] ?? seeded()[name] ?? ''
  const setValue = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }))
  const filled = (): Record<string, string> => Object.fromEntries(workflowInputs()
    .map((input) => [input.name, valueOf(input.name)])
    .filter(([, value]) => value !== ''))
  const workflowReady = () => !props.workflow
    || (!!defId() && !workflowInputs().some((input) => input.required && !valueOf(input.name).trim()))

  // The task a failed start left behind. A refusal keeps the modal open, and without this the next
  // press would make a second task for the same item rather than retrying the run on the first.
  const [made, setMade] = createSignal<Task | null>(null)

  /** The run, once there is a task to run it on. A refusal keeps the modal open and says why. */
  const startWorkflow = async (task: Task, done: (task: Task) => void): Promise<void> => {
    const step = props.workflow
    if (!step) return done(task)
    try {
      await step.onStart(task.id, defId(), filled())
    } catch (err) {
      setMade(task)
      setError(err instanceof Error ? err.message : 'The task was made, but the workflow did not start.')
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
    if (!projectId || !title().trim() || (isGitProject && !b) || !workflowReady()) return
    setBusy(true)
    setError('')
    const retry = made()
    if (retry) return startWorkflow(retry, props.onCreated)
    try {
      const context = { projectId, owner: github()?.owner ?? '', repo: github()?.name ?? '', branch: isGitProject ? b : undefined, existingBranches: props.existingBranches }
      const base = await Promise.resolve(promotion().prepare(props.item, context))
      const seed: TaskSeed = isGitProject
        ? { ...base, title: title().trim(), branch: b }
        : { ...base, title: title().trim(), branch: undefined }
      const task = await promotion().create(seed)
      await promotion().afterCreate?.(task, props.item, context)
      await startWorkflow(task, props.onCreated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the task.')
      setBusy(false)
    }
  }

  async function submitAttach(e: Event) {
    e.preventDefault()
    const attach = promotion().attachToCurrentTask
    const task = props.attachTasks.find((t) => t.id === attachId())
    if (!attach || !task || !workflowReady()) return
    setBusy(true)
    setError('')
    try {
      await attach(task.id, props.item)
      await startWorkflow(task, props.onAttached)
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
        {/* Above the tabs, because which workflow to run is a question about the item and the tabs
            are a question about where it lands (docs/workflows.md § Starting a run). */}
        <Show when={props.workflow}>
          {(step) => (
            <div class="overlay-body">
              <Field label="Workflow" group>
                <Select
                  size="sm"
                  label="Workflow"
                  value={defId()}
                  options={step().definitions.map((entry) => ({ value: entry.id, label: entry.name }))}
                  onChange={setDefId}
                />
              </Field>
              {/* `<For>` over a list that only changes when the definition does, so no row is
                  rebuilt under the caret while somebody is typing in it. */}
              <For each={workflowInputs()}>
                {(input) => (
                  <Field label={input.required ? `${input.name} *` : input.name} hint={input.description} group>
                    <Input
                      size="sm"
                      label={input.name}
                      value={valueOf(input.name)}
                      invalid={!!input.required && !valueOf(input.name).trim()}
                      onInput={(value) => setValue(input.name, value)}
                    />
                  </Field>
                )}
              </For>
            </div>
          )}
        </Show>
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
                <input
                  class="ui-input"
                  type="text"
                  placeholder="branch (from title)"
                  title="Branch name — defaults to a slug of the title"
                  value={branchTouched() || branch().trim() ? branch() : defaultBranch()}
                  onInput={(e) => {
                    // Read and store the edit before switching the value expression to the touched
                    // branch. Solid updates synchronously, so flipping the flag first would restore
                    // the seeded value before `currentTarget.value` was read.
                    const value = e.currentTarget.value
                    setBranch(value)
                    setBranchTouched(true)
                  }}
                />
              </Show>
              <div class="close-actions">
                <Button onPress={props.onClose}>Cancel</Button>
                <Button submit disabled={busy() || !workflowReady() || !title().trim() || (project()?.vcs === 'git' && !effectiveBranch())}>
                  {props.workflow ? 'Create & run' : 'Create task'}
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
                <Button submit disabled={busy() || !workflowReady() || !attachId()}>
                  {props.workflow ? 'Attach & run' : 'Attach'}
                </Button>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </div>
  )
}
