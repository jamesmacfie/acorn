import { For, Show, createEffect, createSignal, on, onMount } from 'solid-js'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { BridgeHandoffItem, BridgeWorkflow } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Button, Card, Field, Textarea } from '@acorn/client-core/kit/components/primitives.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import {
  collectItemWorkflowInputs,
  itemWorkflowInputsReady,
  prefillFromItem,
} from '@acorn/plugin-workflows/contract/itemInputs.ts'
import { CallFailure, isUncertain } from '../messages'
import type { PageHandoff } from '../handoffs'
import { outsideItemLink } from '../acornLinks'
import type { AgentCounts } from '../taskPages'
import { OpenInAcorn } from './OpenInAcorn'
import { PageTaskRow } from './TaskRow'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from '../capture'
import { errorGuidance } from './guidance'

// What the item's context becomes in a draft: the plugin's proposal, or the item's title and address
// when it proposed none.
const handoffCapture = (item: BridgeHandoffItem): Extract<PageCapture, { kind: 'context' }> => ({
  kind: 'context',
  id: crypto.randomUUID(),
  url: item.url,
  title: item.title,
  capturedAt: Date.now(),
  label: item.context?.label ?? item.identifier,
  content: item.context?.content ?? `${item.identifier}: ${item.title}\n${item.url}`,
})

// What a workflow input shows before the person types: the definition's default, then what the item
// fills in by the desktop's rule.
const seededValues = (workflow: BridgeWorkflow, item: BridgeHandoffItem): Record<string, DataValue> => {
  const prefill = prefillFromItem({ title: item.title, body: item.context?.content, link: item.url })
  return Object.fromEntries(
    workflow.inputs.flatMap((input) => {
      const value = prefill[input.name] ?? input.default
      return value === undefined ? [] : [[input.name, value]]
    }),
  )
}

// The plugin's logo, when the panel has its mark. Only the kit's own marks, such as GitHub's, reach the
// extension: a plugin registers its marks in the desktop's client, which the panel doesn't load.
const pluginMark = (pluginId: string) => (brandMarkRegistry.get(pluginId) ? `brand:${pluginId}` : 'file-text')

// One handoff on one Node, as This page's card: the item, and in a project that tracks it, Create task
// or a workflow run in a new task. An item a task already holds shows that task instead. A created
// task's item waits for its first conversation, where it lands in the draft, so nothing reaches an
// agent until the person sends; a workflow's agents start at once. docs/browser-extension/handoffs.md.
export function Handoff(props: {
  client: BridgeClient
  nodeId: string
  handoff: PageHandoff
  // Whether the tab still shows the item, as a pull request's other tabs do.
  onPage: boolean
  online: boolean
  // Whether Open in Acorn may open the desktop app, or copies its link.
  opensLinks: boolean
  projectName(id: string): string
  projectWorkspace(id: string): string | undefined
  agents(taskId: string): AgentCounts
  openTask(taskId: string): void
  // Create task made the item's task: open it, with this item waiting for its first conversation.
  createdTask(projectId: string, taskId: string, item: PageCapture): void
  // Start run made the item's task and started this run in it.
  startedWorkflow(projectId: string, taskId: string, runId: string): void
  // The tab left the item, and closing the card loses nothing.
  dismiss(): void
}) {
  const [items, setItems] = createSignal<BridgeHandoffItem[] | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [chosen, setChosen] = createSignal(0)
  const [projectId, setProjectId] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  // Each project's runnable workflows, as last read, the one chosen, if any, and what the person typed.
  const [workflows, setWorkflows] = createSignal<Record<string, BridgeWorkflow[]>>({})
  const [workflowId, setWorkflowId] = createSignal('')
  const [values, setValues] = createSignal<Record<string, string>>({})
  // The chip's menu asked for a workflow, so the first one is chosen once the list arrives.
  let wantsWorkflow = props.handoff.start === 'workflow'
  // A create keeps its key, so a retry, after an unconfirmed create or a failed start, can't make a
  // second task. A start keeps its own for the same task, workflow, and values.
  let lastCreate: { key: string; identifier: string; connectionId: string; projectId: string } | null = null
  let lastStart: { key: string; taskId: string; workflowId: string; inputs: string } | null = null

  const target = () => ({
    pluginId: props.handoff.pluginId,
    handoffId: props.handoff.handoffId,
    url: props.handoff.url,
  })
  const item = () => items()?.[chosen()] ?? null
  // Creating or starting is for an item no task holds yet.
  const startable = () => !!item()?.projects.length && !item()?.linkedTasks.length

  const choose = (index: number) => {
    setChosen(index)
    setProjectId(items()?.[index]?.projects[0]?.id ?? '')
    setValues({})
  }

  const chosenProject = () => item()?.projects.find((project) => project.id === projectId())?.name ?? ''
  const projectWorkflows = () => workflows()[projectId()] ?? null
  const workflow = () => projectWorkflows()?.find((each) => each.id === workflowId()) ?? null
  const loadWorkflows = async (forProject: string) => {
    if (workflows()[forProject]) return
    try {
      const result = await props.client.call({ op: 'workflows.list', nodeId: props.nodeId, projectId: forProject })
      setWorkflows((lists) => ({ ...lists, [forProject]: result.workflows }))
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    }
  }
  // Read up front, so Run workflow's picker opens on the list.
  createEffect(() => startable() && projectId() && void loadWorkflows(projectId()))
  createEffect(() => {
    const first = projectWorkflows()?.[0]
    if (!wantsWorkflow || !first) return
    wantsWorkflow = false
    setWorkflowId(first.id)
  })
  const workflowItems = () =>
    (projectWorkflows() ?? []).map((each) => ({
      id: each.id,
      label: each.name,
      group: chosenProject(),
      active: each.id === workflowId(),
    }))
  const workflowsEmpty = () =>
    projectWorkflows() ? 'This project has no workflow to run. Publish one in Acorn.' : 'Loading workflows…'

  const valueOf = (name: string): string => {
    const value = values()[name] ?? (item() && workflow() ? seededValues(workflow()!, item()!)[name] : undefined)
    return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  }
  const ready = () => !!workflow() && itemWorkflowInputsReady(workflow()!.id, workflow()!.inputs, valueOf)
  const cancelWorkflow = () => {
    setWorkflowId('')
    setValues({})
  }

  const resolve = async () => {
    setProblem(null)
    setItems(null)
    try {
      const result = await props.client.call({ op: 'handoff.resolve', nodeId: props.nodeId, ...target() })
      setItems(result.items)
      choose(0)
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    }
  }
  onMount(() => void resolve())

  // The linked task, made or found again, or null with `problem` saying why there isn't one.
  const create = async (current: BridgeHandoffItem, forProject: string) => {
    const same =
      lastCreate?.identifier === current.identifier &&
      lastCreate.connectionId === current.connection.id &&
      lastCreate.projectId === forProject
    const key = same ? lastCreate!.key : crypto.randomUUID()
    lastCreate = { key, identifier: current.identifier, connectionId: current.connection.id, projectId: forProject }
    try {
      const { task } = await props.client.call({
        op: 'handoff.create',
        nodeId: props.nodeId,
        ...target(),
        identifier: current.identifier,
        connectionId: current.connection.id,
        projectId: forProject,
        key,
      })
      return task
    } catch (error) {
      if (error instanceof CallFailure && isUncertain(error.code))
        setProblem("The Node didn't confirm the new task. Start it again to retry; the Node won't make a second one.")
      else setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
      return null
    }
  }

  // The run's ID, or null with `problem` saying why there isn't one.
  const startRun = async (taskId: string, chosen: BridgeWorkflow, inputs: Record<string, DataValue>) => {
    const asked = { taskId, workflowId: chosen.id, inputs: JSON.stringify(inputs) }
    const same =
      lastStart?.taskId === asked.taskId &&
      lastStart.workflowId === asked.workflowId &&
      lastStart.inputs === asked.inputs
    const key = same ? lastStart!.key : crypto.randomUUID()
    lastStart = { key, ...asked }
    try {
      const result = await props.client.call({
        op: 'workflow.start',
        nodeId: props.nodeId,
        taskId,
        defId: chosen.id,
        ...(Object.keys(inputs).length ? { inputs } : {}),
        key,
      })
      return result.runId
    } catch (error) {
      if (error instanceof CallFailure && isUncertain(error.code))
        setProblem("The Node didn't confirm the run. Start it again to retry; the Node won't start a second one.")
      else setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
      return null
    }
  }

  // Makes the linked task, then for a run starts the chosen workflow in it. A retry after either step
  // failed reuses both keys, so nothing is made twice.
  const submit = async (run: boolean) => {
    const current = item()
    const forProject = projectId()
    const chosen = workflow()
    if (!current || !forProject || creating() || (run && !ready())) return
    let inputs: Record<string, DataValue> = {}
    if (run) {
      try {
        inputs = collectItemWorkflowInputs(chosen!.inputs, valueOf)
      } catch (error) {
        setProblem(`Check the workflow's inputs: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    setCreating(true)
    setProblem(null)
    try {
      const task = await create(current, forProject)
      if (!task) return
      if (!run) return props.createdTask(task.projectId, task.id, handoffCapture(current))
      const runId = await startRun(task.id, chosen!, inputs)
      if (runId) props.startedWorkflow(task.projectId, task.id, runId)
    } finally {
      setCreating(false)
    }
  }

  // The person typed a workflow input, which leaving the page mustn't throw away.
  const edited = () => Object.keys(values()).length > 0
  // Leaving the item's page closes the card, unless closing it would lose what they typed or a start
  // under way.
  createEffect(
    on(
      () => props.onPage,
      (here) => !here && !edited() && !creating() && props.dismiss(),
      { defer: true },
    ),
  )

  return (
    <div class="handoff" role="group" aria-label="Handoff">
      <Card pad="sm">
        <Show when={!props.onPage && edited()}>
          <p class="notice">This is about a page you've left. It stays open so what you typed isn't lost.</p>
        </Show>
        <Show when={problem()}>
          {(message) => (
            <div class="row">
              <p class="problem grow" role="alert">
                {message()}
              </p>
              <Button size="sm" onPress={() => void resolve()}>
                Try again
              </Button>
            </div>
          )}
        </Show>
        <Show when={items()} fallback={problem() ? null : <p class="quiet">Looking it up…</p>}>
          {(resolved) => (
            <Show when={item()} fallback={<p class="notice">Nothing on this page is an item this Node can open.</p>}>
              {(current) => (
                <>
                  <div class="item-head">
                    <Icon name={pluginMark(props.handoff.pluginId)} tone="brand" />
                    <div class="item-text">
                      <span class="item-id">
                        <Show when={resolved().length > 1} fallback={<b>{current().identifier}</b>}>
                          <Picker
                            label={current().identifier}
                            ariaLabel="Item"
                            size="sm"
                            variant="ghost"
                            placeholder="Filter items"
                            emptyText="No item matches."
                            items={resolved().map((candidate, index) => ({
                              id: String(index),
                              label: candidate.identifier,
                              note: candidate.title,
                              active: index === chosen(),
                            }))}
                            onPick={(index) => choose(Number(index))}
                          />
                        </Show>
                        <span>{current().connection.label}</span>
                      </span>
                      <strong class="item-title">{current().title}</strong>
                    </div>
                    <OpenInAcorn
                      href={outsideItemLink(props.nodeId, current().url)}
                      opensLinks={props.opensLinks}
                      iconOnly
                    />
                  </div>
                  <Show
                    when={!current().linkedTasks.length}
                    fallback={
                      <ul class="task-rows" aria-label="Linked tasks">
                        <For each={current().linkedTasks}>
                          {(task) => (
                            <PageTaskRow
                              title={task.title}
                              project={props.projectName(task.projectId)}
                              branch={null}
                              agents={props.agents(task.id)}
                              onPress={() => props.openTask(task.id)}
                            />
                          )}
                        </For>
                      </ul>
                    }
                  >
                    <Show
                      when={current().projects.length}
                      fallback={<p class="notice">No project on this Node tracks {current().identifier}.</p>}
                    >
                      <Show
                        when={current().projects.length > 1}
                        fallback={
                          <p class="hint">
                            <Icon name="folder" tone="muted" />
                            {current().projects[0]!.name}
                          </p>
                        }
                      >
                        <Field label="Project" layout="row">
                          <Picker
                            label={chosenProject()}
                            ariaLabel="Project"
                            size="sm"
                            placeholder="Filter projects"
                            emptyText="No project matches."
                            items={current().projects.map((project) => ({
                              id: project.id,
                              label: project.name,
                              note: props.projectWorkspace(project.id),
                              group: 'Tracks this issue',
                              active: project.id === projectId(),
                            }))}
                            onPick={setProjectId}
                          />
                        </Field>
                      </Show>
                      <Show
                        when={workflow()}
                        fallback={
                          <div class="row">
                            <Button
                              size="sm"
                              variant="solid"
                              tone="accent"
                              busy={creating()}
                              disabled={!props.online}
                              onPress={() => void submit(false)}
                            >
                              <Icon name="plus" />
                              Create task
                            </Button>
                            <Picker
                              label="Run workflow"
                              ariaLabel="Run workflow"
                              size="sm"
                              disabled={creating()}
                              placeholder="Filter workflows"
                              emptyText={workflowsEmpty()}
                              items={workflowItems()}
                              onPick={setWorkflowId}
                            />
                          </div>
                        }
                      >
                        {(chosen) => (
                          <>
                            <hr class="divider" />
                            <Field label="Workflow" layout="row">
                              <Picker
                                label={chosen().name}
                                ariaLabel="Workflow"
                                size="sm"
                                placeholder="Filter workflows"
                                emptyText={workflowsEmpty()}
                                items={workflowItems()}
                                onPick={setWorkflowId}
                              />
                            </Field>
                            <For each={chosen().inputs}>
                              {(input) => (
                                <Field label={input.label ?? input.name} required={input.required}>
                                  <Textarea
                                    name={`input-${input.name}`}
                                    rows={2}
                                    required={input.required}
                                    placeholder={input.description}
                                    value={valueOf(input.name)}
                                    onInput={(value) => setValues((typed) => ({ ...typed, [input.name]: value }))}
                                  />
                                </Field>
                              )}
                            </For>
                            <div class="row">
                              <Button
                                size="sm"
                                variant="solid"
                                tone="accent"
                                busy={creating()}
                                disabled={!props.online || !ready()}
                                onPress={() => void submit(true)}
                              >
                                <Icon name="play" />
                                Start run
                              </Button>
                              <Button size="sm" variant="ghost" disabled={creating()} onPress={cancelWorkflow}>
                                Cancel
                              </Button>
                            </div>
                          </>
                        )}
                      </Show>
                    </Show>
                  </Show>
                </>
              )}
            </Show>
          )}
        </Show>
      </Card>
    </div>
  )
}
