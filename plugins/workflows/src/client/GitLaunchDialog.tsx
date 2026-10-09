import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, projectsOptions, tasksOptions, workspaceForProject, workspacesOptions } from '@acorn/plugin-api/client'
import { createTaskDraftStore } from '@acorn/plugin-api/client/task-draft'
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { Project } from '@acorn/protocol/api.ts'
import type { WorkflowDefSummary } from '../contract/wire.ts'
import type { WorkflowGitLaunchRequest } from '../contract/gitLaunch.ts'
import { workflowApi } from './workflowsClient'
import { startWorkflow } from './startWorkflow'
import { openWorkflowRun } from './runs/runStore'
import TypedValueField from './editor/TypedValueField'
import { forgetGitLaunchSession, gitLaunchSession } from './gitLaunchSession'

export default function GitLaunchDialog(props: { request: WorkflowGitLaunchRequest; onClose: () => void }) {
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForProject(workspaces.data, props.request.projectId)
  const [defs] = createResource(() => workspace()?.id ?? null, (id) => workflowApi.defsList(id))
  return <Show when={projects.data && defs()}>
    {(loaded) => <GitLaunchForm request={props.request} projects={projects.data!} definitions={loaded().workflows} onClose={props.onClose} />}
  </Show>
}

function GitLaunchForm(props: { request: WorkflowGitLaunchRequest; projects: Project[]; definitions: WorkflowDefSummary[]; onClose: () => void }) {
  const session = gitLaunchSession(props.request)
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const definitions = createMemo(() => props.definitions.filter((entry) => !entry.problems?.length &&
    (entry.projectId == null || entry.projectId === props.request.projectId) && (entry.source !== 'database' || !!entry.publishedRevision)))
  const [defId, setDefId] = createSignal(session.defId)
  const chosen = () => definitions().find((entry) => entry.id === (defId() || definitions()[0]?.id))
  const [values, setValues] = createSignal<Record<string, DataValue>>(session.values)
  const [invalid, setInvalid] = createSignal<Record<string, boolean>>({})
  const inputs = () => chosen()?.inputs ?? []
  const filled = () => ({ ...Object.fromEntries(inputs().filter((input) => input.default !== undefined).map((input) => [input.name, input.default!])), ...values() })
  const ready = () => !!chosen() && inputs().every((input) => !input.required || filled()[input.name] !== undefined) && !Object.values(invalid()).some(Boolean)
  const model = createTaskDraftStore({ mode: 'new', nodeId: props.request.nodeId, projectId: props.request.projectId,
    projects: props.projects, title: props.request.title, baseCommit: props.request.commitId }, () => tasks.data, props.onClose, navigate,
  async (task) => {
    session.task = task
    if (activeNodeId() !== props.request.nodeId) throw new Error('Return to the original Node to start this workflow on its task.')
    const selected = chosen()
    if (!selected) throw new Error('Choose a workflow.')
    const defId = selected.source === 'database' ? selected.id : `${selected.source}:${selected.id}`
    const input = filled()
    const opened = (runId: string) => {
      forgetGitLaunchSession(props.request)
      props.onClose()
      openWorkflowRun(task, runId, navigate)
    }
    const answer = await startWorkflow(task.id, { defId }, Object.keys(input).length ? input : undefined, opened)
    if (answer.error) throw new Error(answer.error)
    if (!answer.runId) throw new Error('The workflow did not return a run ID.')
    opened(answer.runId)
  }, session.task ?? undefined)
  const close = () => { if (!model.saving()) props.onClose() }
  return <Modal title="Start workflow here" onDismiss={close} size="md">
    <Modal.Body><Stack gap="row">
      <Text tone="muted" wrap>Node {props.request.nodeId ?? 'local'} · project {props.request.projectId}</Text>
      <Text tone="muted" wrap>Starting commit {props.request.commitId}</Text>
      <Show when={activeNodeId() !== props.request.nodeId}><Alert>Return to the original Node to continue this launch.</Alert></Show>
      <Show when={!definitions().length}><Alert>No runnable workflows are available for this project.</Alert></Show>
      <Show when={model.error()}><Alert>{model.error()}</Alert></Show>
      <Show when={model.createdTask()}>{(task) => <Alert>Task {task().title} was created. Retry on this task or open it.</Alert>}</Show>
      <Field label="Workflow"><Select value={chosen()?.id ?? ''} options={definitions().map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(id) => { session.defId = id; setDefId(id); setInvalid({}) }} /></Field>
      <For each={inputs()}>{(input) => <TypedValueField label={input.required ? `${input.label ?? input.name} *` : input.label ?? input.name}
        schema={input.schema} required={input.required} hint={input.description} value={filled()[input.name]}
        onValidity={(valid) => setInvalid((current) => ({ ...current, [input.name]: !valid }))}
        onChange={(value) => setValues((current) => { const next = { ...current }; if (value === undefined) delete next[input.name]; else next[input.name] = value; session.values = next; return next })} />}</For>
      <Field label="Task title"><Input value={model.text()} onInput={model.setText} /></Field>
      <Field label="New branch" error={model.branchError()}><Input value={model.branchTouched() ? model.branchText() : model.checkedAvailability()?.branch ?? model.effectiveBranch()} onInput={model.setBranch} /></Field>
      <Checkbox size="sm" label="Skip setup script" checked={model.skipSetup()} onChange={model.setSkipSetup} />
    </Stack></Modal.Body>
    <Modal.Actions>
      <Button variant="ghost" onPress={close}>Cancel</Button>
      <Show when={model.createdTask()}><Button variant="ghost" onPress={() => { forgetGitLaunchSession(props.request); model.openCreatedTask() }}>Open task</Button></Show>
      <Button variant="solid" disabled={!ready() || !model.canSubmit()} onPress={() => void model.submit()}>{model.createdTask() ? 'Retry workflow' : 'Create task and run'}</Button>
    </Modal.Actions>
  </Modal>
}
