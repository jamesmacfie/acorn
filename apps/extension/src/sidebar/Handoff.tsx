import { For, Show, createEffect, createSignal, onMount } from 'solid-js'
import type { BridgeHandoffItem } from '@acorn/protocol/extensionBridge.ts'
import { TURN_TEXT_MAX_CHARS } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure, isUncertain } from '../messages'
import type { PageHandoff } from '../handoffs'
import { itemTaskLink, outsideItemLink } from '../acornLinks'
import { OpenInAcorn } from './OpenInAcorn'
import { AgentSelect, agentChoice } from './agentChoice'
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

// The first message Start task suggests, for the person to edit before they send it.
const firstMessage = (item: BridgeHandoffItem) => `Read ${item.identifier} (${item.title}) and list what is left to do.`

// One handoff on one Node: resolve the page, then let the person chat in or open a linked task, start
// a task in a project the plugin tied the item to, or add the item to any task. The item's context
// only ever lands in a draft; nothing is sent from here. docs/browser-extension/handoffs.md.
export function Handoff(props: {
  client: BridgeClient
  nodeId: string
  handoff: PageHandoff
  online: boolean
  // Whether Open in Acorn may open the desktop app, or copies its link.
  opensLinks: boolean
  // Open this task's newest conversation, or a new chat when it has none, with this context waiting.
  openTask(projectId: string, taskId: string, capture: PageCapture): void
  // Start task made a task and a conversation in it: open it with this draft, unsent.
  startedTask(projectId: string, taskId: string, sessionId: string, draft: { text: string; capture: PageCapture }): void
  dismiss(): void
}) {
  const [items, setItems] = createSignal<BridgeHandoffItem[] | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [chosen, setChosen] = createSignal(0)
  const [projectId, setProjectId] = createSignal('')
  const [message, setMessage] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const agents = agentChoice(props.client, props.nodeId)
  // A create keeps its key, so a retry, after an unconfirmed create or a failed chat start, can't make
  // a second task.
  let lastCreate: { key: string; identifier: string; connectionId: string; projectId: string } | null = null

  const target = () => ({
    pluginId: props.handoff.pluginId,
    handoffId: props.handoff.handoffId,
    url: props.handoff.url,
  })
  const item = () => items()?.[chosen()] ?? null
  // Start task is for an item no task holds yet.
  const startable = () => !!item()?.projects.length && !item()?.linkedTasks.length
  createEffect(() => startable() && void agents.load())

  const choose = (index: number) => {
    const next = items()?.[index]
    setChosen(index)
    setProjectId(next?.projects[0]?.id ?? '')
    setMessage(next ? firstMessage(next) : '')
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

  // Makes the linked task and a conversation with the chosen agent, then opens it with the message and
  // the item in its draft. A retry after either step failed reuses both keys, so nothing is made twice.
  const startTask = async () => {
    const current = item()
    const forProject = projectId()
    if (!current || !forProject || creating()) return
    setCreating(true)
    setProblem(null)
    try {
      const task = await create(current, forProject)
      const session = task && (await agents.start(task.id))
      if (task && session)
        props.startedTask(task.projectId, task.id, session.id, {
          text: message().trim(),
          capture: handoffCapture(current),
        })
    } finally {
      setCreating(false)
    }
  }

  const projectName = (id: string) => item()?.projects.find((project) => project.id === id)?.name

  return (
    <div class="handoff" role="group" aria-label="Handoff">
      <p class="quiet">{props.handoff.url}</p>
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
                      <h3>Start task</h3>
                      <div class="row">
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
                        <AgentSelect agents={agents} />
                      </div>
                      <textarea
                        name="first-message"
                        aria-label="First message"
                        rows={3}
                        maxLength={TURN_TEXT_MAX_CHARS}
                        value={message()}
                        onInput={(event) => setMessage(event.currentTarget.value)}
                      />
                      <ul class="chips">
                        <li class="chip">Item · {current().title}</li>
                      </ul>
                      <div class="row">
                        <button
                          type="button"
                          disabled={creating() || !props.online || !agents.chosen()}
                          onClick={() => void startTask()}
                        >
                          {creating() ? 'Starting…' : 'Start task'}
                        </button>
                        <span class="quiet grow">Nothing goes to the agent until you press Send.</span>
                      </div>
                      <Show when={agents.problem()}>
                        {(message) => (
                          <p class="problem" role="alert">
                            {message()}
                          </p>
                        )}
                      </Show>
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
