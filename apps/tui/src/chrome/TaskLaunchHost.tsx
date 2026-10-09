/** @jsxImportSource @acorn/tui/jsx */
import { createQuery } from '@tanstack/solid-query'
import { Show } from 'solid-js'
import { projectsOptions, tasksOptions, type Project } from '@acorn/client-core/infra/queries.ts'
import { createTaskDraftStore } from '@acorn/client-core/features/tabs/taskDraftStore.ts'
import { closeTaskLaunch, type TaskLaunchRequest } from '@acorn/client-core/features/tabs/taskLaunch.ts'
import { useNavigate } from '../kit/router'
import { Alert } from '../kit/showing'
import { Button, Checkbox, Input } from '../kit/asking'
import { Line } from '../kit/cells'
import { Modal, ModalBody } from '../kit/grouping'

export default function TaskLaunchHost(props: { request: TaskLaunchRequest }) {
  const projects = createQuery(() => projectsOptions(true))
  return <Show when={projects.data} fallback={<Modal title="Start task here" onDismiss={closeTaskLaunch}><ModalBody><Line>Loading projects…</Line></ModalBody></Modal>}>
    {(rows) => <TaskLaunchForm request={props.request} projects={rows()} />}
  </Show>
}

function TaskLaunchForm(props: { request: TaskLaunchRequest; projects: Project[] }) {
  const tasks = createQuery(() => tasksOptions(true))
  const model = createTaskDraftStore({ mode: 'new', ...props.request, projects: props.projects }, () => tasks.data, closeTaskLaunch, useNavigate())
  return <Modal title="Start task here" onDismiss={closeTaskLaunch} size="wide"><ModalBody>
    <Line role="muted">Node {props.request.nodeId ?? 'local'} · project {props.request.projectId}</Line>
    <Show when={props.request.baseCommit}><Line role="muted">Starting commit {props.request.baseCommit}</Line></Show>
    <Show when={props.request.worktreePath}><Line role="muted">Attach {props.request.worktreePath}</Line></Show>
    <Show when={model.error()}><Alert tone="danger">{model.error()}</Alert></Show>
    <Line>Title</Line><Input value={model.text()} onInput={model.setText} />
    <Show when={!props.request.worktreePath}>
      <Line>New branch</Line><Input value={model.branchTouched() ? model.branchText() : model.checkedAvailability()?.branch ?? model.effectiveBranch()} onInput={model.setBranch} />
      <Show when={model.branchError()}><Alert tone="danger">{model.branchError()}</Alert></Show>
      <Checkbox label="Skip setup script" checked={model.skipSetup()} onChange={model.setSkipSetup} />
    </Show>
    <Button disabled={!model.canSubmit()} onPress={() => void model.submit()}>Create task</Button>
    <Button variant="bare" onPress={closeTaskLaunch}>Cancel</Button>
  </ModalBody></Modal>
}
