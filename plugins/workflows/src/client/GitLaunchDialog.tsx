import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useLocation, useNavigate } from '@solidjs/router'
import { activeNodeId, readJson, workspaceForProject } from '@acorn/plugin-api/client'
import { createTaskDraftStore } from '@acorn/plugin-api/client/task-draft'
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { projectsRoute, tasksRoute, workspacesRoute, type Project, type ProjectsResponse, type Task, type Workspace } from '@acorn/protocol/api.ts'
import type { WorkflowDefSummary } from '../contract/wire.ts'
import type { WorkflowGitLaunchRequest } from '../contract/gitLaunch.ts'
import { workflowApiForNode } from './workflowsClient'
import { startWorkflow } from './startWorkflow'
import { openWorkflowRun } from './runs/runStore'
import TypedValueField from './editor/TypedValueField'
import { forgetGitLaunchSession, forgetUnusedGitLaunchSession, gitLaunchSession } from './gitLaunchSession'
import { workflowGitLaunchRequest } from '../contract/gitLaunch.ts'

export default function GitLaunchDialog(props: { request: WorkflowGitLaunchRequest; onClose: () => void }) {
  const api = workflowApiForNode(props.request.nodeId)
  const session = gitLaunchSession(props.request)
  const dismiss = () => { props.onClose(); forgetUnusedGitLaunchSession(props.request, session) }
  const location = useLocation()
  const openedAt = location.pathname
  const current = () => activeNodeId() === props.request.nodeId && location.pathname === openedAt
    && (!props.request.tracked || workflowGitLaunchRequest() === props.request)
  const [target, { refetch }] = createResource(async () => {
    const [projects, workspaces] = await Promise.all([
      readJson<ProjectsResponse>(projectsRoute, { nodeId: props.request.nodeId }),
      readJson<Workspace[]>(workspacesRoute, { nodeId: props.request.nodeId }),
    ])
    if (!projects.projects.some((project) => project.id === props.request.projectId)) throw new Error('This project is unavailable on the selected Node.')
    const workspace = workspaceForProject(workspaces, props.request.projectId)
    if (!workspace) throw new Error('This project is not in an available workspace.')
    const definitions = await api.defsList(workspace.id)
    return { projects: projects.projects, definitions: definitions.workflows }
  })
  return <Modal title="Start workflow here" onDismiss={dismiss} size="md">
    <Show when={target.loading}><Modal.Body><Text>Loading workflow definitions…</Text></Modal.Body></Show>
    <Show when={target.error}><Modal.Body><Stack gap="row"><Alert>{String(target.error)}</Alert><Button onPress={() => void refetch()}>Retry loading</Button></Stack></Modal.Body></Show>
    <Show when={!target.loading && !target.error && target()}>{(loaded) =>
      <GitLaunchForm request={props.request} projects={loaded().projects} definitions={loaded().definitions}
        onClose={dismiss} current={current} api={api} session={session} />
    }</Show>
    <Show when={target.loading || target.error}><Modal.Actions><Button onPress={dismiss}>Close</Button></Modal.Actions></Show>
  </Modal>
}

function GitLaunchForm(props: { request: WorkflowGitLaunchRequest; projects: Project[]; definitions: WorkflowDefSummary[];
  onClose: () => void; current: () => boolean; api: ReturnType<typeof workflowApiForNode>;
  session: ReturnType<typeof gitLaunchSession> }) {
  const session = props.session
  const navigate = useNavigate()
  const [tasks] = createResource(() => readJson<Task[]>(tasksRoute, { nodeId: props.request.nodeId }))
  const definitions = createMemo(() => props.definitions.filter((entry) => !entry.problems?.length &&
    (entry.projectId == null || entry.projectId === props.request.projectId) && (entry.source !== 'database' || !!entry.publishedRevision)))
  const [defId, setDefId] = createSignal(session.defId)
  const chosen = () => definitions().find((entry) => entry.id === (session.invocation()?.selectionId ?? (defId() || definitions()[0]?.id)))
  const [values, setValues] = createSignal<Record<string, DataValue>>(session.values)
  const [invalid, setInvalid] = createSignal<Record<string, boolean>>({})
  const inputs = () => chosen()?.inputs ?? []
  const filled = () => session.invocation()?.inputs ?? { ...Object.fromEntries(inputs().filter((input) => input.default !== undefined).map((input) => [input.name, input.default!])), ...values() }
  const ready = () => !!session.invocation() || !!chosen() && inputs().every((input) => !input.required || filled()[input.name] !== undefined) && !Object.values(invalid()).some(Boolean)
  const model = createTaskDraftStore({ mode: 'new', nodeId: props.request.nodeId, projectId: props.request.projectId,
    projects: props.projects, title: props.request.title, baseCommit: props.request.commitId,
    targetIdentity: session.targetIdentity ?? undefined }, tasks, props.onClose, navigate,
  async (task) => {
    if (!props.current()) throw new Error('The launch moved. Reopen it to continue on this task.')
    const invocation = session.invocation()
    if (!invocation) throw new Error('Choose a workflow.')
    const opened = (runId: string) => {
      session.setRunId(runId)
      if (props.current()) { props.onClose(); openWorkflowRun(task, runId, navigate); forgetGitLaunchSession(props.request, session) }
    }
    const answer = await startWorkflow(task.id, { defId: invocation.definitionId }, Object.keys(invocation.inputs).length ? invocation.inputs : undefined,
      opened, session.launchId, props.api)
    if (answer.error) throw new Error(answer.error)
    if (!answer.runId) throw new Error('The workflow did not return a run ID.')
    const visible = props.current()
    opened(answer.runId)
    if (!visible) throw new Error('The launch moved. Reopen it to view the run.')
  }, session.task, session.setTask, (identity) => { session.targetIdentity ??= identity })
  const submit = async () => {
    if (session.pending() || session.runId() || !props.current() || !ready() || !model.canSubmit()) return
    if (!session.invocation()) {
      const selected = chosen()!
      session.setInvocation({ selectionId: selected.id,
        definitionId: selected.source === 'database' ? selected.id : `${selected.source}:${selected.id}`,
        inputs: structuredClone(filled()) })
    }
    session.setPending(true)
    try { await model.submit() } finally { session.setPending(false) }
  }
  return <>
    <Modal.Body><Stack gap="row">
      <Text tone="muted" wrap>Node {props.request.nodeId ?? 'local'} · project {props.request.projectId}</Text>
      <Text tone="muted" wrap>Starting commit {props.request.commitId}</Text>
      <Show when={!props.current()}><Alert>Return to the original Node and project to continue this launch.</Alert></Show>
      <Show when={!definitions().length}><Alert>No runnable workflows are available for this project.</Alert></Show>
      <Show when={model.error()}><Alert>{model.error()}</Alert></Show>
      <Show when={model.createdTask()}>{(task) => <Alert>Task {task().title} was created. {session.runId() ? 'Open the task or its run.' : 'Retry on this task or open it.'}</Alert>}</Show>
      <Show when={session.pending()}><Alert>The launch request is still finishing.</Alert></Show>
      <Show when={session.runId()}>{(runId) => <Alert>Workflow run {runId()} was created. Open that run.</Alert>}</Show>
      <Field label="Workflow"><Select disabled={!!session.invocation()} value={chosen()?.id ?? ''} options={definitions().map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(id) => { if (session.invocation()) return; session.defId = id; setDefId(id); setInvalid({}) }} /></Field>
      <For each={inputs()}>{(input) => <TypedValueField label={input.required ? `${input.label ?? input.name} *` : input.label ?? input.name}
        schema={input.schema} required={input.required} hint={input.description} value={filled()[input.name]} disabled={!!session.invocation()}
        onValidity={(valid) => { if (!session.invocation()) setInvalid((current) => ({ ...current, [input.name]: !valid })) }}
        onChange={(value) => { if (session.invocation()) return; setValues((current) => { const next = { ...current }; if (value === undefined) delete next[input.name]; else next[input.name] = value; session.values = next; return next }) }} />}</For>
      <Show when={!model.createdTask()}>
        <Field label="Task title"><Input value={model.text()} onInput={model.setText} /></Field>
        <Field label="New branch" error={model.branchError()}><Input value={model.branchTouched() ? model.branchText() : model.checkedAvailability()?.branch ?? model.effectiveBranch()} onInput={model.setBranch} /></Field>
        <Checkbox size="sm" label="Skip setup script" checked={model.skipSetup()} onChange={model.setSkipSetup} />
      </Show>
    </Stack></Modal.Body>
    <Modal.Actions>
      <Button variant="ghost" onPress={props.onClose}>Cancel</Button>
      <Show when={model.createdTask()}><Button variant="ghost" onPress={() => {
        if (!props.current()) return
        model.openCreatedTask()
        if (session.runId()) forgetGitLaunchSession(props.request, session)
      }}>Open task</Button></Show>
      <Show when={session.runId()}>{(runId) => <Button variant="solid" onPress={() => {
        const task = session.task()
        if (task && props.current()) { props.onClose(); openWorkflowRun(task, runId(), navigate); forgetGitLaunchSession(props.request, session) }
      }}>Open run</Button>}</Show>
      <Show when={!session.runId()}><Button variant="solid" disabled={!props.current() || session.pending() || !ready() || !model.canSubmit()}
        onPress={() => void submit()}>{model.createdTask() ? 'Retry workflow' : 'Create task and run'}</Button></Show>
    </Modal.Actions>
  </>
}
