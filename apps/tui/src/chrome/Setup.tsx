/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsKey, integrationsOptions, projectsKey, projectsOptions, tasksKey, workspacesKey, type Project, type Task } from '@acorn/client-core/infra/queries.ts'
import { createCredentialForm, createDeviceFlow } from '@acorn/client-core/features/integrations'
import { createProject, createWorkspace } from '@acorn/client-core/features/workspaces'
import { createTask, taskBridge } from '@acorn/client-core/features/tasks'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
import { defaultBranchForTask } from '@acorn/client-core/features/tasks'
import { isValidBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import { Alert } from '../kit/showing'
import { Button, Checkbox, Input, Select } from '../kit/asking'
import { Line } from '../kit/cells'
import { Modal, ModalBody } from '../kit/grouping'
import type { ShellModel } from './model'
import { useNavigate } from '../kit/router'
import { focusRegion } from '../keys/regions'
import { PANES, TASKS } from './topology'

export type SetupStep = 'workspace' | 'project' | 'task' | 'provider' | 'done'

/** The first-run and return-to-setup route. All writes go through the same client mutations as the
 * desktop. The only host choice here is asking for an absolute path instead of an OS folder picker. */
export function Setup(props: { model: ShellModel; nodeId: string; initialStep?: SetupStep; onClose: () => void }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const projects = createQuery(() => projectsOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))
  const [step, setStep] = createSignal<SetupStep>(props.initialStep ?? 'workspace')
  const [workspaceId, setWorkspaceId] = createSignal(props.model.workspace()?.id ?? '')
  const [projectId, setProjectId] = createSignal('')
  const [workspaceName, setWorkspaceName] = createSignal('')
  const [path, setPath] = createSignal('')
  const [title, setTitle] = createSignal('')
  const [branch, setBranch] = createSignal('')
  const [branchEdited, setBranchEdited] = createSignal(false)
  const [useCurrentBranch, setUseCurrentBranch] = createSignal(false)
  const [skipSetup, setSkipSetup] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [result, setResult] = createSignal('')
  const [createdTask, setCreatedTask] = createSignal<Task | null>(null)
  const [providerId, setProviderId] = createSignal('')
  const connectable = () => (integrations.data?.providers ?? []).filter((provider) =>
    provider.connection.connectable &&
    (provider.connection.maxConnections === undefined ||
      (integrations.data?.integrations ?? []).filter((connection) => connection.providerId === provider.id).length < provider.connection.maxConnections),
  )
  const selectedProvider = () => connectable().find((provider) => provider.id === providerId()) ?? connectable()[0]
  const connected = async () => {
    await client.invalidateQueries({ queryKey: integrationsKey })
    setResult(`${selectedProvider()?.label ?? 'Provider'} connected.`)
    setStep('done')
  }
  const credential = createCredentialForm(selectedProvider, connected)
  const deviceFlow = createDeviceFlow(() => selectedProvider()?.id, connected)

  const inWorkspace = () => (projects.data ?? []).filter((project) => project.workspaceId === workspaceId())
  const project = () => (projects.data ?? []).find((row) => row.id === projectId())
  createEffect(() => {
    if (!workspaceId() && props.model.workspaces().length) setWorkspaceId(props.model.workspace()?.id ?? props.model.workspaces()[0]!.id)
  })
  createEffect(() => {
    if (!inWorkspace().some((row) => row.id === projectId())) setProjectId(inWorkspace()[0]?.id ?? '')
  })
  createEffect(() => {
    if (!projects.data) return
    if (step() === 'task' && !inWorkspace().length) setStep(workspaceId() ? 'project' : 'workspace')
  })

  const [config] = createResource(() => projectId(), async (id) => id ? taskBridge().project.get(id).catch(() => null) : null)
  const branches = () => props.model.allTasks().filter((task) => task.projectId === projectId()).flatMap((task) => task.branch ? [task.branch] : [])
  const suggestedBranch = () => defaultBranchForTask(title(), config()?.config.branchPrefix, branches())
  const effectiveBranch = () => branchEdited() ? slugifyBranch(branch()) : suggestedBranch()

  const run = async (action: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const addWorkspace = () => void run(async () => {
    const name = workspaceName().trim()
    if (!name) throw new Error('Enter a workspace name.')
    const created = await createWorkspace(name)
    await client.invalidateQueries({ queryKey: workspacesKey })
    setWorkspaceId(created.id)
    props.model.chooseWorkspace(created.id)
    setWorkspaceName('')
    setResult(`Workspace ${created.name} created.`)
    setStep('project')
  })

  const addProject = () => void run(async () => {
    const folder = path().trim()
    if (!folder) throw new Error('Enter an absolute folder path on this node.')
    if (!workspaceId()) throw new Error('Choose or create a workspace first.')
    const { project: created } = await createProject({ path: folder, workspaceId: workspaceId() })
    await Promise.all([
      client.invalidateQueries({ queryKey: projectsKey }),
      client.invalidateQueries({ queryKey: workspacesKey }),
    ])
    setProjectId(created.id)
    setPath('')
    setResult(`Project ${created.name} added.`)
    setStep('task')
  })

  const addTask = () => void run(async () => {
    const name = title().trim()
    const selected = project()
    if (!selected) throw new Error('Choose or add a project first.')
    if (!name) throw new Error('Enter a task title.')
    const candidate = effectiveBranch()
    if (selected.vcs === 'git' && !useCurrentBranch() && !isValidBranch(candidate)) {
      throw new Error('Enter a valid branch name or use the project folder and its current branch.')
    }
    const task: Task = await createTask({
      origin: 'local', projectId: selected.id, title: name,
      ...(selected.vcs === 'git' && !useCurrentBranch() ? { branch: candidate, skipSetup: skipSetup() } : {}),
    })
    await client.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(task)
    navigate(pathForTask(task))
    setCreatedTask(task)
    setResult(`Task ${task.title} created in ${selected.name}.`)
    setStep('done')
  })

  const selectedWorkspace = () => props.model.workspaces().find((row) => row.id === workspaceId())
  const projectOptions = () => inWorkspace().map((row: Project) => ({ value: row.id, label: `${row.name} · ${row.path ?? 'No folder'}` }))
  const close = () => {
    props.onClose()
    // Project and roster effects may still settle while setup is open. Make the newly created task
    // the final selection when the reader returns to the shell, through the same activation route as
    // the rail rather than leaving the prior browse source on screen.
    const task = createdTask()
    if (task) queueMicrotask(() => {
      activateTaskSignals(task)
      navigate(pathForTask(task))
      queueMicrotask(() => { if (!focusRegion(PANES)) focusRegion(TASKS) })
    })
  }

  return (
    <Modal onDismiss={close} title="Set up acorn" size="wide">
      <ModalBody>
        <box flexDirection="column" gap={1}>
          <Line role="muted">Node: {props.nodeId}</Line>
          <Show when={error()}><Alert tone="danger">{error()}</Alert></Show>
          <Show when={result()}><Line tone="ok">{result()}</Line></Show>
          <Show when={step() === 'workspace'}>
            <Line role="strong">1. Choose a workspace</Line>
            <Show when={props.model.workspaces().length}>
              <Select value={workspaceId()} options={props.model.workspaces().map((row) => ({ value: row.id, label: row.name }))} onChange={setWorkspaceId} />
            </Show>
            <Line role="muted">Or create one:</Line>
            <Input placeholder="Workspace name" value={workspaceName()} onInput={setWorkspaceName} onSubmit={addWorkspace} />
            <Button disabled={busy() || !workspaceName().trim()} onPress={addWorkspace}>Create workspace</Button>
            <Show when={selectedWorkspace()}><Button onPress={() => { props.model.chooseWorkspace(workspaceId()); setStep('project'); setResult('') }}>Continue with {selectedWorkspace()!.name}</Button></Show>
            <Button variant="bare" onPress={() => setStep('provider')}>Set up a provider</Button>
          </Show>
          <Show when={step() === 'project'}>
            <Line role="strong">2. Choose a project in {selectedWorkspace()?.name ?? 'this workspace'}</Line>
            <Show when={projectOptions().length}>
              <Select value={projectId()} options={projectOptions()} onChange={setProjectId} />
              <Button onPress={() => { setStep('task'); setResult('') }}>Continue with {project()?.name ?? 'project'}</Button>
            </Show>
            <Line role="muted">Add a folder by its absolute path on the node:</Line>
            <Input placeholder="/absolute/path/to/project" value={path()} onInput={setPath} onSubmit={addProject} />
            <Button disabled={busy() || !path().trim()} onPress={addProject}>Add folder</Button>
            <Button variant="bare" onPress={() => setStep('workspace')}>Back to workspaces</Button>
          </Show>
          <Show when={step() === 'task'}>
            <Line role="strong">3. Start a task in {project()?.name ?? 'the project'}</Line>
            <Input placeholder="Task title" value={title()} onInput={setTitle} onSubmit={addTask} />
            <Show when={project()?.vcs === 'git'}>
              <Checkbox label="Use the project folder and its current branch" checked={useCurrentBranch()} onChange={setUseCurrentBranch} />
              <Show when={!useCurrentBranch()}>
                <Line role="muted">Branch: {branchEdited() ? branch() : suggestedBranch()}</Line>
                <Input placeholder="Custom branch (optional)" value={branch()} onInput={(value) => { setBranch(value); setBranchEdited(true) }} />
                <Checkbox label="Skip setup script" checked={skipSetup()} onChange={setSkipSetup} />
              </Show>
            </Show>
            <Button disabled={busy() || !title().trim()} onPress={addTask}>Create task</Button>
            <Button variant="bare" onPress={() => setStep('project')}>Back to projects</Button>
          </Show>
          <Show when={step() === 'done'}>
            <Line role="strong">The task is open. Choose a pane with Tab and Enter.</Line>
            <Line role="muted">Managed agents use an installed Claude or Codex CLI.</Line>
            <Line role="muted">API keys also enable model features.</Line>
            <Button onPress={() => setStep('provider')}>Connect a provider</Button>
            <Button onPress={close}>Start working</Button>
            <Button variant="bare" onPress={() => { setStep('project'); setResult('') }}>Add another task or project</Button>
          </Show>
          <Show when={step() === 'provider'}>
            <Line role="strong">Connect a provider</Line>
            <Line role="muted">Installed agent CLIs appear in the Agent pane.</Line>
            <Line role="muted">Add an API key or provider connection on this node.</Line>
            <For each={integrations.data?.integrations ?? []}>
              {(connection) => <Line>{connection.label} · {connection.status}</Line>}
            </For>
            <Show when={integrations.isLoading}><Line role="muted">Loading providers…</Line></Show>
            <Show when={integrations.error}><Alert tone="danger">Could not load providers: {String(integrations.error)}</Alert></Show>
            <Show when={connectable().length} fallback={<Line role="muted">No additional provider is available on this node.</Line>}>
              <Select value={selectedProvider()?.id ?? ''} options={connectable().map((provider) => ({ value: provider.id, label: provider.label }))}
                onChange={(value) => { deviceFlow.cancel(); credential.reset(); setProviderId(value) }} />
              <Show when={selectedProvider()?.connection.kind === 'device-flow'} fallback={
                <box flexDirection="column" gap={1}>
                  <For each={credential.fields()}>
                    {(field) => (
                      <box flexDirection="column">
                        <Line>{field.label}{field.required ? ' · required' : ''}</Line>
                        <Input type={field.type} value={credential.value(field.id)} placeholder={field.placeholder ?? field.label}
                          onInput={(value) => credential.setValue(field.id, value)} />
                        <Show when={field.hint}><Line role="muted">{field.hint}</Line></Show>
                      </box>
                    )}
                  </For>
                  <Show when={credential.error()}><Alert tone="danger">{credential.error()}</Alert></Show>
                  <Button disabled={!credential.complete() || credential.busy()} onPress={() => void credential.submit()}>Connect {selectedProvider()?.label ?? 'provider'}</Button>
                </box>
              }>
                <Button disabled={deviceFlow.busy()} onPress={() => void deviceFlow.start()}>Get sign-in code</Button>
                <Show when={deviceFlow.device()}>{(device) => <Line>Open {device().verificationUri} and enter code {device().userCode}</Line>}</Show>
                <Show when={deviceFlow.error()}><Alert tone="danger">{deviceFlow.error()}</Alert></Show>
              </Show>
            </Show>
            <Button variant="bare" onPress={() => setStep('workspace')}>Back to setup</Button>
            <Button variant="bare" onPress={close}>Close setup</Button>
          </Show>
        </box>
      </ModalBody>
    </Modal>
  )
}
