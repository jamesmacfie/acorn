import { createEffect, createMemo, createResource, Show } from 'solid-js'
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
  type ItemRowTarget,
  type Task,
} from '@acorn/plugin-api/client'
import { PromoteToTaskModal } from '@acorn/plugin-api/ui/host'
import { workflowApi } from './workflowsClient'
import { closeStartFromItem, prefillFromItem, startFromItemTarget } from './startFromItem'

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

function StartFromItem(props: { target: ItemRowTarget }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForProject(workspaces.data, props.target.projectId)

  // Every definition the workspace can run: its own rows, its projects' committed files, and the user
  // layer, merged by the node (./workflowsClient.ts § defsList). A definition with a problem is left
  // out rather than offered and refused at start.
  const [defs] = createResource(
    () => workspace()?.id || null,
    async (workspaceId) => workflowApi.defsList(workspaceId),
  )
  const definitions = createMemo(() => (defs()?.workflows ?? []).filter((entry) => !entry.problems?.length))

  const attachTasks = createMemo(() => {
    const projectIds = new Set(workspace()?.projects.map((project) => project.id) ?? [])
    return (tasks.data ?? []).filter((task) =>
      task.status === 'active' && (projectIds.size === 0 || projectIds.has(task.projectId)))
  })

  const prefill = createMemo(() => prefillFromItem({
    title: props.target.title,
    ...(props.target.body ? { body: props.target.body } : {}),
    ...(props.target.link ? { link: props.target.link } : {}),
  }))

  // Where the run landed, so `onCreated` can address the pane without threading a second callback
  // through the modal. One entry, written and read in the same gesture.
  const started = new Map<string, string>()

  // The node resolves the id and, for a committed file, hashes the bytes on disk. Same call the
  // editor's Run and the palette make, so a refusal reads the same everywhere; the modal catches the
  // throw and keeps itself open with the message.
  const start = async (taskId: string, defId: string, inputs: Record<string, string>): Promise<void> => {
    const answer = await workflowApi.start(taskId, { defId }, Object.keys(inputs).length ? inputs : undefined)
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
    toast('This workspace has no workflows. Make one from the Workflows rail.')
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
        workflow={{ definitions: definitions(), prefill: prefill(), onStart: start }}
        onClose={closeStartFromItem}
        onCreated={land}
        onAttached={land}
      />
    </Show>
  )
}
