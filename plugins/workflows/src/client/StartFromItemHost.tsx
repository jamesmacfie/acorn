import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activateTaskSignals,
  pathForTask,
  tasksKey,
  tasksOptions,
  toast,
  workspaceForProject,
  workspacesOptions,
  type Task,
} from '@acorn/plugin-api/client'
import { PromoteToTaskModal } from '@acorn/plugin-api/ui/host'
import { Field, Input, Select } from '@acorn/plugin-api/ui'
import { workflowApi } from './workflowsClient'
import { startWorkflow } from './startWorkflow'
import { closeStartFromItem, collectItemWorkflowInputs, itemWorkflowInputsReady, prefillFromItem, prefillFromRecord, startFromItemTarget } from './startFromItem'

// "Start workflow…" on an integration's row, drawn (docs/workflows.md § Starting a run).
//
// The box is the host's promote-to-task modal with a workflow step over its tabs, so the person picks
// a workflow and answers its inputs in the same place they say whether this is a new task or an
// existing one. Nothing about creating or attaching is written here: that is the source's registered
// `promotion`, which is why one component serves Rollbar, Linear and GitHub.
//
// Mounted in the shell's `overlay` slot, because the row that opens it is on a list this plugin does
// not draw. The terminal client mounts no overlay slot and its source panel has no row menu, so this
// never draws there (apps/tui/src/plugins/SourcePanel.tsx).

/** The one mount point. Draws nothing until a row menu asks. */
export default function StartFromItemHost() {
  return (
    <Show when={startFromItemTarget()}>
      {(target) => <StartFromItem target={target()} />}
    </Show>
  )
}

function StartFromItem(props: { target: import('./startFromItem').WorkflowSourceItemTarget }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForProject(workspaces.data, props.target.projectId)

  // Every definition the workspace can run: its own rows, its projects' committed files, and the user
  // layer, merged by the node (./workflowsClient.ts § defsList). Only published database definitions
  // and file definitions without known problems can be offered for a run.
  const [defs] = createResource(
    () => workspace()?.id || null,
    async (workspaceId) => workflowApi.defsList(workspaceId),
  )
  const definitions = createMemo(() => (defs()?.workflows ?? []).filter((entry) =>
    !entry.problems?.length && (entry.source !== 'database' || !!entry.publishedRevision)))
  const [defId, setDefId] = createSignal('')
  const selectedDefId = () => defId() || definitions()[0]?.id || ''
  const chosen = createMemo(() => definitions().find((entry) => entry.id === selectedDefId()))
  const workflowInputs = () => chosen()?.inputs ?? []
  const [values, setValues] = createSignal<Record<string, string>>({})

  const attachTasks = createMemo(() => {
    const projectIds = new Set(workspace()?.projects.map((project) => project.id) ?? [])
    return (tasks.data ?? []).filter((task) =>
      task.status === 'active' && (projectIds.size === 0 || projectIds.has(task.projectId)))
  })

  const prefill = createMemo(() => ({ ...prefillFromItem({
    title: props.target.title,
    ...(props.target.body ? { body: props.target.body } : {}),
    ...(props.target.link ? { link: props.target.link } : {}),
  }), ...(props.target.record ? prefillFromRecord(props.target.record) : {}) }))

  const seeded = createMemo(() => ({
    ...Object.fromEntries(workflowInputs().filter((input) => input.default !== undefined).map((input) => [input.name, input.default!])),
    ...Object.fromEntries(workflowInputs().filter((input) => prefill()[input.name] !== undefined)
      .map((input) => [input.name, prefill()[input.name]])),
  }))
  const valueOf = (name: string): string => {
    const value = values()[name] ?? seeded()[name]
    return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  }
  const filled = (): Record<string, DataValue> => collectItemWorkflowInputs(workflowInputs(), valueOf)
  const ready = () => itemWorkflowInputsReady(selectedDefId(), workflowInputs(), valueOf)

  // Where the run landed, so `onCreated` can address the pane without threading a second callback
  // through the modal. One entry, written and read in the same gesture.
  const started = new Map<string, string>()

  // The node resolves the id and, for a committed file, hashes the bytes on disk. Same call the
  // editor's Run and the palette make, so a refusal reads the same everywhere; the modal catches the
  // throw and keeps itself open with the message.
  const start = async (taskId: string, defId: string, inputs: Record<string, DataValue>): Promise<void> => {
    const answer = await startWorkflow(taskId, { defId }, Object.keys(inputs).length ? inputs : undefined)
    if (answer.error) throw new Error(answer.error)
    if (answer.runId) started.set(taskId, answer.runId)
  }

  const land = (task: Task): void => {
    closeStartFromItem()
    void queryClient.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(task)
    const runId = started.get(task.id)
    navigate(runId ? `${pathForTask(task)}?pane=workflows&item=${encodeURIComponent(runId)}` : pathForTask(task))
  }

  // No modal for an empty list: a box whose one control is an empty select cannot be answered. The
  // toast says where workflows come from instead. An effect rather than a fallback, because closing
  // is a write and a render may not do one.
  createEffect(() => {
    if (defs.state !== 'ready' || definitions().length) return
    closeStartFromItem()
    toast('This workspace has no runnable workflows. Create and publish one from the Workflows rail.')
  })

  return (
    <Show when={definitions().length}>
      <PromoteToTaskModal
        providerId={props.target.providerId}
        item={props.target.item}
        headerLabel={`Start a workflow — ${props.target.title}`}
        itemTitle={props.target.title}
        attachTasks={attachTasks()}
        existingBranches={(tasks.data ?? []).flatMap((task) => (task.branch ? [task.branch] : []))}
        action={{
          label: 'run',
          ready,
          onTaskReady: (task) => start(task.id, selectedDefId(), filled()),
          content: <>
            <Field label="Workflow" group>
              <Select size="sm" label="Workflow" value={selectedDefId()}
                options={definitions().map((entry) => ({ value: entry.id, label: entry.name }))} onChange={setDefId} />
            </Field>
            <For each={workflowInputs()}>
              {(input) => (
                <Field label={input.required ? `${input.name} *` : input.name} hint={input.description} group>
                  <Input size="sm" label={input.name} value={valueOf(input.name)}
                    invalid={!!input.required && !valueOf(input.name).trim()}
                    onInput={(value) => setValues((current) => ({ ...current, [input.name]: value }))} />
                </Field>
              )}
            </For>
          </>,
        }}
        onClose={closeStartFromItem}
        onCreated={land}
        onAttached={land}
      />
    </Show>
  )
}
