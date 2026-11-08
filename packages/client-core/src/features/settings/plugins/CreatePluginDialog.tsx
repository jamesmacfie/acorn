import { createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginScaffoldRequest } from '@acorn/protocol/api.ts'
import { ApiError } from '../../../infra/node/apiClient'
import { clientCapability } from '../../../infra/node/clientCapabilities'
import { scaffoldNodePlugin } from '../../../infra/node/nodePlugins'
import { projectsKey, tasksOptions, workspacesKey, workspacesOptions, type Task } from '../../../infra/queries'
import { clientEvents } from '../../../host/registries/commands/clientEvents'
import { Alert, Button, Checkbox, Field, Input, SegmentedControl, Select } from '../../../kit/components/primitives'
import { Modal } from '../../../kit/components/overlays/Modal'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import { AGENT_SESSION_STARTER } from '../../agent/sessionStarter'
import { dataSourceCatalogOptions } from '../../dataSources/queries'
import { toast } from '../../notifications/toast'
import { activateTaskSignals, pathForTask } from '../../tasks/activate'
import { createTask } from '../../tasks/taskMutations'
import { createActiveWorkspaceId } from '../../workspaces/activeWorkspaceId'
import { canAddProjectFromFolder, pickNodeFolder } from '../../workspaces/addProject'
import { createProject, createWorkspace } from '../../workspaces/workspaceMutations'
import { createWorkspacesMode } from '../../workspaces/workspacesMode'
import { dataSourceStarterPrompt, pluginStarterPrompt } from './starterPrompts'

const NEW_WORKSPACE = '\0new'
// A first guess the Node checks against the manifest's ID rule.
const toId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

// shortcut: forgotten on reload, so a folder written before a reload gets the plain not-empty message.
// Ask the Node whether the folder holds this plugin's scaffold if that turns out to matter.
const scaffoldedFolders = new Set<string>()

type Picked = { source: string; name: string }

/** Create a plugin in a project of its own (docs/plugins/agent-install.md § Teaching the agent). Start
 *  writes the scaffold into the folder, makes it a project, opens a new task there, and leaves the
 *  starter prompt unsent in an agent session's composer. */
export function CreatePluginDialog(props: {
  variant: 'plugin' | 'data-source'
  nodeId: string
  onClose: () => void
  onOpenAgents: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const starter = clientCapability(AGENT_SESSION_STARTER)
  const [agents] = createResource(async () => (starter ? await starter.choices() : []))
  const agentList = () => (agents.state === 'ready' ? agents() : [])
  const mode = createWorkspacesMode()
  const workspaces = createQuery(() => workspacesOptions(true))
  const activeWorkspace = createActiveWorkspaceId()

  const [name, setName] = createSignal('')
  const [editedId, setEditedId] = createSignal<string>()
  const pluginId = () => editedId() ?? toId(name())
  const [folder, setFolder] = createSignal('')
  const [kind, setKind] = createSignal<'pane' | 'trigger'>('pane')
  const [row, setRow] = createSignal('')
  const [picked, setPicked] = createSignal<Picked[]>([])
  const [pickedWorkspace, setPickedWorkspace] = createSignal<string>()
  const workspace = () => pickedWorkspace() ?? activeWorkspace() ?? workspaces.data?.[0]?.id ?? NEW_WORKSPACE
  const [newWorkspace, setNewWorkspace] = createSignal('')
  const [chosenAgent, setChosenAgent] = createSignal<string>()
  const agent = () => chosenAgent() ?? agentList()[0]?.id
  const [git, setGit] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  // What Start has finished, so Try again picks up after it. Once the scaffold is on disk the fields it
  // used lock, because a retry must make the project from the same folder.
  const [scaffolded, setScaffolded] = createSignal(false)
  let task: Task | undefined

  const catalog = createQuery(() => ({
    ...dataSourceCatalogOptions(props.nodeId, { parameters: {} }),
    enabled: props.variant === 'data-source',
  }))
  const toggle = (input: Picked, on: boolean) =>
    setPicked((current) => (on ? [...current, input] : current.filter((entry) => entry.source !== input.source)))

  const workspacesOn = () => mode() === 'on'
  const folderProblem = () =>
    folder().trim() && !isAbsolute(folder().trim()) ? 'Use a full path, such as /Users/you/plugins/hello.' : undefined
  const ready = () =>
    !!name().trim() &&
    !!pluginId().trim() &&
    !!folder().trim() &&
    !folderProblem() &&
    (props.variant === 'plugin' || (!!row().trim() && picked().length > 0)) &&
    (!workspacesOn() || workspace() !== NEW_WORKSPACE || !!newWorkspace().trim()) &&
    !!agent()

  // The picker chooses where the package goes, and the package gets a folder of its own there, as
  // `npm create acorn-plugin` makes one.
  const choose = async () => {
    const parent = await pickNodeFolder(props.nodeId)
    if (parent) setFolder(`${parent.replace(/[\\/]+$/, '')}/${pluginId()}`)
  }

  // Names the step that failed, so the alert says how far Start got.
  const step = async <T,>(what: string, work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (cause) {
      throw new Error(`Couldn't ${what}. ${reason(cause)}`)
    }
  }

  const scaffold = async (target: { folder: string; pluginId: string; name: string }) => {
    const request: PluginScaffoldRequest =
      props.variant === 'data-source'
        ? {
            ...target,
            git: git(),
            kind: 'data-source',
            dataSource: { row: row().trim(), inputs: picked().map((input) => ({ source: input.source })) },
          }
        : { ...target, git: git(), kind: kind() }
    const key = `${props.nodeId}\0${target.folder}`
    try {
      const result = await scaffoldNodePlugin(request, props.nodeId)
      if (typeof result.git === 'object') toast(`The folder isn't a git repository. ${result.git.skipped}`)
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.code === 'not-empty'))
        throw new Error(`Couldn't write the starter files. ${reason(cause)}`)
      throw new Error(
        scaffoldedFolders.has(key)
          ? 'That folder has files in it. Pick a new or empty folder. To keep it, add the folder as a project in Settings → Workspaces.'
          : 'That folder has files in it. Pick a new or empty folder.',
      )
    }
    scaffoldedFolders.add(key)
    setScaffolded(true)
  }

  const start = async () => {
    if (!starter) return
    setBusy(true)
    setError('')
    try {
      const target = { folder: folder().trim(), pluginId: pluginId().trim(), name: name().trim() }
      let workspaceId = workspacesOn() ? workspace() : undefined
      if (workspaceId === NEW_WORKSPACE) {
        const created = await step('create the workspace', () => createWorkspace(newWorkspace().trim()))
        workspaceId = created.id
        // The select now names it, so Try again doesn't make a second one.
        setPickedWorkspace(workspaceId)
        await queryClient.invalidateQueries({ queryKey: workspacesKey })
      }
      if (!scaffolded()) await scaffold(target)
      const { project } = await step('add the folder as a project', () =>
        createProject({ path: target.folder, name: target.name, ...(workspaceId ? { workspaceId } : {}) }).catch(
          (cause: unknown) => {
            // With workspaces off, every project is its own workspace.
            if (cause instanceof ApiError && cause.code === 'workspaces_off')
              return createProject({ path: target.folder, name: target.name })
            throw cause
          },
        ),
      )
      task ??= await step('create the task', () =>
        createTask({ origin: 'manual', projectId: project.id, title: `${target.name} plugin` }, props.nodeId),
      )
      const opened = task
      await Promise.all(
        [projectsKey, workspacesKey, tasksOptions(true).queryKey].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
      const draft =
        props.variant === 'data-source'
          ? dataSourceStarterPrompt({ ...target, row: row().trim(), inputs: picked() })
          : pluginStarterPrompt({ ...target, kind: kind() })
      await step('start the agent session', () =>
        starter.start({ taskId: opened.id, title: `Build ${target.name}`, choiceId: agent(), draft }),
      )
      // The starter shows the agent pane in the task's layout, so activating keeps it rather than picking
      // a default. Settings is a layer over the router, so it closes on its own word.
      activateTaskSignals(opened)
      navigate(pathForTask(opened))
      clientEvents.emit('presentation:close-settings', {})
      props.onClose()
    } catch (cause) {
      setError(reason(cause))
    } finally {
      setBusy(false)
    }
  }

  const locked = () => busy() || scaffolded()

  return (
    <Modal
      title={props.variant === 'data-source' ? 'Build a data source' : 'Create a plugin'}
      size="md"
      align="center"
      onDismiss={props.onClose}
    >
      <Modal.Body>
        <Stack gap="row">
          <Field label="Project name" required>
            <Input value={name()} disabled={locked()} onInput={setName} />
          </Field>
          <Field label="Plugin ID" hint="It can't change later.">
            <Input value={pluginId()} disabled={locked()} onInput={setEditedId} />
          </Field>
          <Field label="Folder" hint="A new or empty folder on the Node's computer." error={folderProblem()}>
            <Inline gap="inline">
              <Input
                value={folder()}
                placeholder="/path/to/my-plugin"
                invalid={!!folderProblem()}
                disabled={locked()}
                onInput={setFolder}
              />
              <Show when={canAddProjectFromFolder()}>
                <Button disabled={locked()} onPress={() => void choose()}>
                  Choose…
                </Button>
              </Show>
            </Inline>
          </Field>
          <Show when={props.variant === 'plugin'}>
            <Field label="Kind" group>
              <SegmentedControl
                ariaLabel="Kind"
                value={kind()}
                onChange={setKind}
                options={[
                  { value: 'pane', label: 'Pane', disabled: locked() },
                  { value: 'trigger', label: 'Trigger', disabled: locked() },
                ]}
              />
            </Field>
          </Show>
          <Show when={props.variant === 'data-source'}>
            <Field label="What should one row be?" hint="For example, an issue in this cycle with its pull request.">
              <Input value={row()} disabled={locked()} onInput={setRow} />
            </Field>
            <Field label="Which data does it need?" hint="The first one you pick gives one row per record." group>
              <Show when={!catalog.isPending} fallback={<Text emphasis="muted">Reading the sources…</Text>}>
                <Show when={!catalog.isError} fallback={<Alert>Couldn't read this node's sources.</Alert>}>
                  <For each={catalog.data?.sources ?? []}>
                    {(source) => {
                      const input = { source: `${source.pluginId}:${source.sourceId}`, name: source.name }
                      return (
                        <Checkbox
                          label={source.name}
                          hint={input.source}
                          disabled={locked()}
                          checked={picked().some((entry) => entry.source === input.source)}
                          onChange={(on) => toggle(input, on)}
                        />
                      )
                    }}
                  </For>
                </Show>
              </Show>
            </Field>
          </Show>
          <Show when={workspacesOn()}>
            <Field label="Workspace">
              <Select
                value={workspace()}
                disabled={busy()}
                options={[
                  ...(workspaces.data ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
                  { value: NEW_WORKSPACE, label: 'New workspace…' },
                ]}
                onChange={setPickedWorkspace}
              />
            </Field>
            <Show when={workspace() === NEW_WORKSPACE}>
              <Field label="New workspace name">
                <Input value={newWorkspace()} disabled={busy()} onInput={setNewWorkspace} />
              </Field>
            </Show>
          </Show>
          <Show when={agentList().length > 1}>
            <Field label="Agent">
              <Select
                value={agent()}
                disabled={busy()}
                options={agentList().map((choice) => ({ value: choice.id, label: choice.label }))}
                onChange={setChosenAgent}
              />
            </Field>
          </Show>
          <Checkbox label="Make it a git repository" checked={git()} disabled={locked()} onChange={setGit} />
          <Show when={!starter}>
            <Alert tone="muted">Turn on the Agents plugin to start a session.</Alert>
          </Show>
          <Show when={starter && agents.state === 'errored'}>
            <Alert>Couldn't read the agents on this Node.</Alert>
          </Show>
          <Show when={starter && agents.state === 'ready' && !agentList().length}>
            <Alert
              tone="muted"
              actions={
                <Button size="sm" variant="ghost" onPress={props.onOpenAgents}>
                  Open Settings → Agents
                </Button>
              }
            >
              Install or sign in to an agent first.
            </Alert>
          </Show>
          <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        </Stack>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.onClose}>
          Cancel
        </Button>
        <Button variant="solid" tone="accent" busy={busy()} disabled={!ready()} onPress={() => void start()}>
          {error() ? 'Try again' : 'Start'}
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
