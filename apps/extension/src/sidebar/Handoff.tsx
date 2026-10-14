import { For, Show, createEffect, createSignal, on, onMount } from 'solid-js'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { BridgeHandoffItem, BridgeWorkflow } from '@acorn/protocol/extensionBridge.ts'
import {
  collectItemWorkflowInputs,
  itemWorkflowInputsReady,
  prefillFromItem,
} from '@acorn/plugin-workflows/contract/itemInputs.ts'
import { CallFailure, isUncertain } from '../messages'
import type { HandoffStart, PageHandoff } from '../handoffs'
import { itemTaskLink, outsideItemLink } from '../acornLinks'
import { OpenInAcorn } from './OpenInAcorn'
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

// One handoff on one Node: resolve the page, then let the person chat in or open a linked task, or, in
// a project the plugin tied the item to, create a task or start a workflow in a new one, as the chip's
// menu chose. A created task's item context only ever lands in a draft, so nothing reaches an agent
// until the person sends; a workflow's agents start at once. docs/browser-extension/handoffs.md.
export function Handoff(props: {
  client: BridgeClient
  nodeId: string
  handoff: PageHandoff
  // Whether the tab still shows the item, as a pull request's other tabs do.
  onPage: boolean
  online: boolean
  // Whether Open in Acorn may open the desktop app, or copies its link.
  opensLinks: boolean
  // Open this task's newest conversation, or a new chat when it has none, with this context waiting.
  openTask(projectId: string, taskId: string, capture: PageCapture): void
  // Create task made the item's task: show it, with this context waiting for its first conversation.
  createdTask(projectId: string, taskId: string, capture: PageCapture): void
  // Start workflow made the item's task and started this run in it.
  startedWorkflow(projectId: string, taskId: string, runId: string): void
  dismiss(): void
}) {
  const [items, setItems] = createSignal<BridgeHandoffItem[] | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [chosen, setChosen] = createSignal(0)
  const [projectId, setProjectId] = createSignal('')
  const [start, setStart] = createSignal<HandoffStart>(props.handoff.start ?? 'task')
  const [creating, setCreating] = createSignal(false)
  // Each project's runnable workflows, as last read, the one chosen, and what the person typed.
  const [workflows, setWorkflows] = createSignal<Record<string, BridgeWorkflow[]>>({})
  const [workflowId, setWorkflowId] = createSignal('')
  const [values, setValues] = createSignal<Record<string, string>>({})
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

  const projectWorkflows = () => workflows()[projectId()] ?? null
  const workflow = () => projectWorkflows()?.find((each) => each.id === workflowId()) ?? projectWorkflows()?.[0] ?? null
  const loadWorkflows = async (forProject: string) => {
    if (workflows()[forProject]) return
    try {
      const result = await props.client.call({ op: 'workflows.list', nodeId: props.nodeId, projectId: forProject })
      setWorkflows((lists) => ({ ...lists, [forProject]: result.workflows }))
    } catch (error) {
      setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    }
  }
  createEffect(() => startable() && start() === 'workflow' && projectId() && void loadWorkflows(projectId()))

  const valueOf = (name: string): string => {
    const value = values()[name] ?? (item() && workflow() ? seededValues(workflow()!, item()!)[name] : undefined)
    return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  }
  const ready = () =>
    start() === 'task' || (!!workflow() && itemWorkflowInputsReady(workflow()!.id, workflow()!.inputs, valueOf))

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

  // Makes the linked task, then for a workflow starts the run in it. A retry after either step failed
  // reuses both keys, so nothing is made twice.
  const submit = async () => {
    const current = item()
    const forProject = projectId()
    const chosen = workflow()
    if (!current || !forProject || creating() || !ready()) return
    let inputs: Record<string, DataValue> = {}
    if (start() === 'workflow') {
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
      if (start() === 'task') return props.createdTask(task.projectId, task.id, handoffCapture(current))
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

  const projectName = (id: string) => item()?.projects.find((project) => project.id === id)?.name

  return (
    <div class="handoff" role="group" aria-label="Handoff">
      <p class="quiet">{props.handoff.url}</p>
      <Show when={!props.onPage && edited()}>
        <p class="notice">This is about a page you've left. It stays open so what you typed isn't lost.</p>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={items()} fallback={problem() ? null : <p class="quiet">Looking it up…</p>}>
        {(resolved) => (
          <Show
            when={resolved().length}
            fallback={<p class="notice">Nothing on this page is an item this Node can open.</p>}
          >
            <Show when={resolved().length > 1}>
              <label>
                Which one
                <select name="handoff-item" onChange={(event) => choose(Number(event.currentTarget.value))}>
                  <For each={resolved()}>
                    {(candidate, index) => (
                      <option value={index()} selected={index() === chosen()}>
                        {`${candidate.identifier} · ${candidate.connection.label}`}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
            <Show when={item()}>
              {(current) => (
                <>
                  <p>
                    <strong>{current().identifier}</strong> {current().title}
                    <span class="quiet"> · {current().connection.label}</span>
                  </p>
                  <Show
                    when={current().linkedTasks.length}
                    fallback={
                      <div class="row">
                        <span class="quiet grow">No task in Acorn for this yet.</span>
                        <OpenInAcorn
                          href={outsideItemLink(props.nodeId, current().url)}
                          opensLinks={props.opensLinks}
                          class="quiet"
                        />
                      </div>
                    }
                  >
                    <ul class="rows" aria-label="Linked tasks">
                      <For each={current().linkedTasks}>
                        {(task) => (
                          <li>
                            <div class="grow">
                              <strong>{task.title}</strong>
                              <span class="quiet">{projectName(task.projectId) ?? ''}</span>
                            </div>
                            <OpenInAcorn
                              href={itemTaskLink(props.nodeId, props.handoff.pluginId, task.id)}
                              opensLinks={props.opensLinks}
                            />
                            <button
                              type="button"
                              class="quiet"
                              onClick={() => props.openTask(task.projectId, task.id, handoffCapture(current()))}
                            >
                              Chat
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <Show
                    when={current().projects.length}
                    fallback={<p class="notice">No project on this Node tracks {current().identifier}.</p>}
                  >
                    <Show when={startable()}>
                      <div class="row">
                        <select
                          name="handoff-start"
                          aria-label="Start"
                          onChange={(event) => setStart(event.currentTarget.value as HandoffStart)}
                        >
                          <option value="task" selected={start() === 'task'}>
                            Create task
                          </option>
                          <option value="workflow" selected={start() === 'workflow'}>
                            Start workflow
                          </option>
                        </select>
                        <Show
                          when={current().projects.length > 1}
                          fallback={<span class="quiet">In {current().projects[0]!.name}</span>}
                        >
                          <select
                            name="handoff-project"
                            aria-label="Project"
                            onChange={(event) => setProjectId(event.currentTarget.value)}
                          >
                            <For each={current().projects}>
                              {(project) => (
                                <option value={project.id} selected={project.id === projectId()}>
                                  {project.name}
                                </option>
                              )}
                            </For>
                          </select>
                        </Show>
                      </div>
                      <Show when={start() === 'workflow'}>
                        <Show when={projectWorkflows()} fallback={<p class="quiet">Loading workflows…</p>}>
                          {(list) => (
                            <Show
                              when={list().length}
                              fallback={
                                <p class="notice">
                                  This project has no workflow to run. Create and publish one in Acorn.
                                </p>
                              }
                            >
                              <select
                                name="handoff-workflow"
                                aria-label="Workflow"
                                onChange={(event) => setWorkflowId(event.currentTarget.value)}
                              >
                                <For each={list()}>
                                  {(each) => (
                                    <option value={each.id} selected={each.id === workflow()?.id}>
                                      {each.name}
                                    </option>
                                  )}
                                </For>
                              </select>
                              <For each={workflow()?.inputs}>
                                {(input) => (
                                  <label>
                                    {input.label ?? input.name}
                                    {input.required ? ' *' : ''}
                                    <textarea
                                      name={`input-${input.name}`}
                                      rows={2}
                                      value={valueOf(input.name)}
                                      onInput={(event) =>
                                        setValues((typed) => ({ ...typed, [input.name]: event.currentTarget.value }))
                                      }
                                    />
                                    <Show when={input.description}>
                                      {(description) => <span class="quiet">{description()}</span>}
                                    </Show>
                                  </label>
                                )}
                              </For>
                            </Show>
                          )}
                        </Show>
                      </Show>
                      <div class="row">
                        <button
                          type="button"
                          disabled={creating() || !props.online || !ready()}
                          onClick={() => void submit()}
                        >
                          {creating() ? 'Starting…' : start() === 'task' ? 'Create task' : 'Start workflow'}
                        </button>
                        <span class="quiet grow">
                          {start() === 'task'
                            ? 'The item waits for the first conversation you open.'
                            : 'The workflow starts its agents straight away.'}
                        </span>
                      </div>
                    </Show>
                  </Show>
                </>
              )}
            </Show>
          </Show>
        )}
      </Show>
      <div class="row">
        <Show when={problem()}>
          <button type="button" class="quiet" onClick={() => void resolve()}>
            Try again
          </button>
        </Show>
        <button type="button" class="quiet" onClick={() => props.dismiss()}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
