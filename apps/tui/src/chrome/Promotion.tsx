/** @jsxImportSource @acorn/tui/jsx */
import { createResource, createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { projectsOptions, tasksKey, tasksOptions, type Task } from '@acorn/client-core/infra/queries.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { defaultBranchForTask, taskBridge } from '@acorn/client-core/features/tasks'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
import { isValidBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import type { TaskSeed } from '@acorn/protocol/api.ts'
import { Alert } from '../kit/showing'
import { Button, Input, Select } from '../kit/asking'
import { Line } from '../kit/cells'
import { Modal, ModalBody } from '../kit/grouping'
import { closePromotion, type PromotionRequest } from './promotionStore'
import { useNavigate } from '../kit/router'
import { focusRegion } from '../keys/regions'
import { PANES, TASKS } from './topology'

/** Text and task choices for a source-row promotion. The source still owns its seed and follow-up
 * link; the terminal only supplies the picker that the desktop renders as a DOM modal. */
export function Promotion(props: { request: PromotionRequest }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const projects = createQuery(() => projectsOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const project = () => projects.data?.find((row) => row.id === props.request.projectId)
  const promotion = () => sourceRegistry.get(props.request.pluginId)?.promotion
  const [config] = createResource(() => props.request.projectId, async (id) => id ? taskBridge().project.get(id).catch(() => null) : null)
  const [mode, setMode] = createSignal<'new' | 'attach'>('new')
  const [title, setTitle] = createSignal(props.request.item.task?.title ?? props.request.item.title)
  const [branch, setBranch] = createSignal(props.request.item.task?.branch ?? '')
  const [branchEdited, setBranchEdited] = createSignal(false)
  const [attachId, setAttachId] = createSignal('')
  const [created, setCreated] = createSignal<Task | null>(null)
  const [linked, setLinked] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const existingBranches = () => (tasks.data ?? []).filter((task) => task.projectId === props.request.projectId)
    .flatMap((task) => task.branch ? [task.branch] : [])
  const context = (candidate?: string) => ({
    projectId: props.request.projectId ?? '',
    owner: project()?.github?.owner ?? '',
    repo: project()?.github?.name ?? '',
    branch: candidate,
    existingBranches: existingBranches(),
  })
  const defaultBranch = () => defaultBranchForTask(title(), config()?.config.branchPrefix, existingBranches())
  const effectiveBranch = () => {
    if (branchEdited()) return slugifyBranch(branch())
    const seeded = branch().trim()
    return seeded ? (isValidBranch(seeded) ? seeded : '') : defaultBranch()
  }
  const attachTasks = () => {
    const workspaceId = project()?.workspaceId
    const projectIds = new Set((projects.data ?? []).filter((row) => row.workspaceId === workspaceId).map((row) => row.id))
    return (tasks.data ?? []).filter((task) => task.status === 'active' && projectIds.has(task.projectId))
  }
  const selectedTask = () => attachTasks().find((task) => task.id === attachId()) ?? attachTasks()[0]
  const eligible = () => !!project() && !!promotion()?.canPromote(props.request.item,
    context(project()?.vcs === 'git' ? effectiveBranch() : undefined))
  const canCreate = () => !!project() && !!promotion() && title().trim().length > 0
    && (project()?.vcs !== 'git' || !!effectiveBranch()) && eligible()

  async function run(action: () => Promise<void>) {
    if (busy()) return
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const finish = async (task: Task) => {
    await client.invalidateQueries({ queryKey: tasksKey })
    closePromotion()
    queueMicrotask(() => {
      activateTaskSignals(task)
      navigate(pathForTask(task))
      queueMicrotask(() => { if (!focusRegion(PANES)) focusRegion(TASKS) })
    })
  }

  const create = () => void run(async () => {
    const operation = promotion()
    if (!operation || !canCreate()) throw new Error('Choose a project and enter a valid task title and branch.')
    const candidate = project()?.vcs === 'git' ? effectiveBranch() : undefined
    let task = created()
    if (!task) {
      const base = await Promise.resolve(operation.prepare(props.request.item, context(candidate)))
      const seed: TaskSeed = { ...base, title: title().trim(), branch: candidate }
      task = await operation.create(seed)
      setCreated(task)
    }
    if (!linked()) {
      await operation.afterCreate?.(task, props.request.item, context(candidate))
      setLinked(true)
    }
    await finish(task)
  })

  const attach = () => void run(async () => {
    const operation = promotion()?.attachToCurrentTask
    const task = selectedTask()
    if (!operation || !task) throw new Error('Choose an active task to attach this item to.')
    await operation(task.id, props.request.item)
    await finish(task)
  })

  return (
    <Modal onDismiss={closePromotion} title="Create or link task" size="wide">
      <ModalBody>
        <box flexDirection="column" gap={1}>
          <Line role="strong">{props.request.item.title}</Line>
          <Line role="muted">Source: {props.request.pluginId} · Project: {project()?.name ?? 'none selected'}</Line>
          <Show when={!project()}><Alert tone="warn">Close this dialog and choose a project with p first.</Alert></Show>
          <Show when={!promotion()}><Alert tone="warn">This source no longer offers task promotion.</Alert></Show>
          <Show when={project() && promotion() && !eligible()}><Alert tone="warn">This source item cannot create a task in the selected project.</Alert></Show>
          <Show when={error()}><Alert tone="danger">{error()}</Alert></Show>
          <Show when={promotion()?.attachToCurrentTask && attachTasks().length && !created()}>
            <Select
              value={mode()}
              options={[{ value: 'new', label: 'New task' }, { value: 'attach', label: 'Attach to task' }]}
              onChange={(value) => setMode(value as 'new' | 'attach')}
            />
          </Show>
          <Show when={mode() === 'new'}>
            <Line>Task title</Line>
            <Input placeholder="Task title" value={title()} onInput={setTitle} onSubmit={create} />
            <Show when={project()?.vcs === 'git'}>
              <Line role="muted">Branch: {effectiveBranch()}</Line>
              <Input placeholder="Custom branch (optional)" value={branchEdited() ? branch() : ''} onInput={(value) => { setBranch(value); setBranchEdited(true) }} />
            </Show>
            <Button disabled={busy() || !canCreate()} onPress={create}>{created() ? 'Retry link to task' : 'Create task'}</Button>
          </Show>
          <Show when={mode() === 'attach' && !created()}>
            <Select
              value={selectedTask()?.id ?? ''}
              options={attachTasks().map((task) => ({ value: task.id, label: `${task.title} · ${task.branch ?? task.projectId}` }))}
              onChange={setAttachId}
            />
            <Button disabled={busy() || !selectedTask()} onPress={attach}>Attach to selected task</Button>
          </Show>
          <Button variant="bare" onPress={closePromotion}>Cancel</Button>
        </box>
      </ModalBody>
    </Modal>
  )
}
