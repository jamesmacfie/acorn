import { For, Show, createSignal, onMount } from 'solid-js'
import type { BridgeHandoffItem } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure } from '../messages'
import type { PageHandoff } from '../handoffs'
import type { BridgeClient } from './bridgeClient'
import type { PageCapture } from './capture'
import { errorGuidance } from './guidance'

// Failures after which a create may or may not have reached the Node.
const UNCERTAIN = new Set(['ambiguous_mutation', 'host_unavailable', 'node_unreachable'])

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

// One handoff on one Node: resolve the page, then let the person open a linked task, create one in a
// project the plugin tied the item to, or find any task themselves. The item's context goes to the
// draft of whatever conversation they open next; nothing is sent from here.
// docs/browser-extension/handoffs.md.
export function Handoff(props: {
  client: BridgeClient
  nodeId: string
  handoff: PageHandoff
  online: boolean
  // Open this task's newest conversation, or a new chat when it has none, with this context waiting.
  openTask(projectId: string, taskId: string, capture: PageCapture): void
  // Let the person find any task in Settings, with this context waiting.
  chooseTask(capture: PageCapture): void
  dismiss(): void
}) {
  const [items, setItems] = createSignal<BridgeHandoffItem[] | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [chosen, setChosen] = createSignal(0)
  const [projectId, setProjectId] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  // An unconfirmed create keeps its key, so creating the same task again can't make a second one.
  let pendingCreate: { key: string; identifier: string; connectionId: string; projectId: string } | null = null

  const target = () => ({
    pluginId: props.handoff.pluginId,
    handoffId: props.handoff.handoffId,
    url: props.handoff.url,
  })
  const item = () => items()?.[chosen()] ?? null

  const choose = (index: number) => {
    setChosen(index)
    setProjectId(items()?.[index]?.projects[0]?.id ?? '')
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

  const create = async () => {
    const current = item()
    const forProject = projectId()
    if (!current || !forProject || creating()) return
    const same =
      pendingCreate?.identifier === current.identifier &&
      pendingCreate.connectionId === current.connection.id &&
      pendingCreate.projectId === forProject
    const key = same ? pendingCreate!.key : crypto.randomUUID()
    pendingCreate = { key, identifier: current.identifier, connectionId: current.connection.id, projectId: forProject }
    setCreating(true)
    setProblem(null)
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
      pendingCreate = null
      props.openTask(task.projectId, task.id, handoffCapture(current))
    } catch (error) {
      if (error instanceof CallFailure && UNCERTAIN.has(error.code))
        setProblem("The Node didn't confirm the new task. Create it again to retry; the Node won't make a second one.")
      else setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    } finally {
      setCreating(false)
    }
  }

  const projectName = (id: string) => item()?.projects.find((project) => project.id === id)?.name

  return (
    <div class="handoff" role="group" aria-label="Handoff">
      <h3>{props.handoff.label}</h3>
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
                  <Show when={current().linkedTasks.length}>
                    <p class="quiet">Linked tasks</p>
                    <ul>
                      <For each={current().linkedTasks}>
                        {(task) => (
                          <li>
                            <div>
                              <strong>{task.title}</strong>
                              <span class="quiet">{projectName(task.projectId) ?? ''}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => props.openTask(task.projectId, task.id, handoffCapture(current()))}
                            >
                              Open
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
                    <div class="row">
                      <Show
                        when={current().projects.length > 1}
                        fallback={<span class="quiet">In {current().projects[0]!.name}</span>}
                      >
                        <select name="handoff-project" onChange={(event) => setProjectId(event.currentTarget.value)}>
                          <For each={current().projects}>
                            {(project) => (
                              <option value={project.id} selected={project.id === projectId()}>
                                {project.name}
                              </option>
                            )}
                          </For>
                        </select>
                      </Show>
                      <button type="button" disabled={creating() || !props.online} onClick={() => void create()}>
                        {creating() ? 'Creating…' : 'Create linked task'}
                      </button>
                    </div>
                  </Show>
                  <div class="row">
                    <button type="button" class="quiet" onClick={() => props.chooseTask(handoffCapture(current()))}>
                      Choose another task
                    </button>
                  </div>
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
