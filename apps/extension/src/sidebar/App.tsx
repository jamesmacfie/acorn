import { For, Show, createEffect, createSignal, on, onMount } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeNodes, BridgeProject } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure, type CallError, type HostState } from '../messages'
import { bridgeClient } from './bridgeClient'
import { errorGuidance, hostGuidance, statusGuidance } from './guidance'
import { Pairing } from './Pairing'

type Projects = { nodeId: string; projects: BridgeProject[] }

export function App(props: { api: BrowserApi }) {
  const [host, setHost] = createSignal<HostState>({ state: 'connecting', message: null, restoreError: null })
  const [fleet, setFleet] = createSignal<BridgeNodes | null>(null)
  const [status, setStatus] = createSignal<NodeStatus | null>(null)
  const [projects, setProjects] = createSignal<Projects | null>(null)
  const [problem, setProblem] = createSignal<CallError | null>(null)
  const [pairing, setPairing] = createSignal(false)

  const client = bridgeClient(props.api, {
    host: setHost,
    // Only the selected Node's status matters, and only while it is still selected.
    status: (next) => next.nodeId === fleet()?.activeNodeId && setStatus(next),
  })
  const selected = () => fleet()?.nodes.find((node) => node.nodeId === fleet()?.activeNodeId) ?? null

  const attempt = async (work: () => Promise<void>) => {
    setProblem(null)
    try {
      await work()
    } catch (error) {
      // A stale reply is expected after a switch, and the bridge banner already explains a missing host.
      if (error instanceof CallFailure && (error.code === 'not_selected' || error.code === 'host_unavailable')) return
      setProblem(error instanceof CallFailure ? error : { code: 'node_error', message: String(error) })
    }
  }
  const showFleet = (next: BridgeNodes) => {
    setFleet(next)
    setStatus(next.status)
  }
  const refresh = () => attempt(async () => showFleet(await client.call({ op: 'nodes.list' })))
  const select = (nodeId: string | null) =>
    attempt(async () => showFleet(await client.call({ op: 'node.select', nodeId })))
  const forget = (nodeId: string) => attempt(async () => showFleet(await client.call({ op: 'node.forget', nodeId })))

  // Projects follow the selection. A reply for a Node that is no longer selected is dropped here as
  // well as refused by the host, so a slow read can't fill another Node's list.
  const loadProjects = (nodeId: string) =>
    attempt(async () => {
      try {
        const result = await client.call({ op: 'projects.list', nodeId })
        if (fleet()?.activeNodeId === result.nodeId) setProjects(result)
      } catch (error) {
        // A list the Node can no longer vouch for is not shown as if it were current.
        if (fleet()?.activeNodeId === nodeId) setProjects(null)
        throw error
      }
    })
  createEffect(
    on(
      () => fleet()?.activeNodeId ?? null,
      (nodeId) => {
        setProjects(null)
        if (nodeId) void loadProjects(nodeId)
      },
    ),
  )

  onMount(() => void refresh())

  return (
    <main>
      <header>
        <h1>Acorn</h1>
      </header>
      <Show when={hostGuidance(host())}>
        {(guidance) => (
          <section class="card problem" role="alert">
            <p>{guidance()}</p>
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          </section>
        )}
      </Show>
      <Show when={host().restoreError}>{(message) => <p class="notice">{message()}</p>}</Show>
      <Show when={problem()}>
        {(error) => (
          <p class="problem" role="alert">
            {errorGuidance(error())}
          </p>
        )}
      </Show>

      <section class="card" aria-label="Nodes">
        <h2>Nodes</h2>
        <Show when={fleet()?.nodes.length} fallback={<p class="quiet">No Node is paired with this browser yet.</p>}>
          <ul class="nodes">
            <For each={fleet()?.nodes}>
              {(node) => (
                <li classList={{ active: node.nodeId === fleet()?.activeNodeId }}>
                  <div>
                    <strong>{node.label}</strong>
                    <span class="quiet">{node.endpoint}</span>
                  </div>
                  <div class="row">
                    <Show
                      when={node.nodeId === fleet()?.activeNodeId}
                      fallback={
                        <button type="button" onClick={() => void select(node.nodeId)}>
                          Use
                        </button>
                      }
                    >
                      <span class="badge">Selected</span>
                    </Show>
                    <button type="button" class="quiet" onClick={() => void forget(node.nodeId)}>
                      Forget
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={!pairing()}>
          <button type="button" onClick={() => setPairing(true)}>
            Pair a Node
          </button>
        </Show>
      </section>

      <Show when={pairing()}>
        <Pairing
          client={client}
          onCancel={() => setPairing(false)}
          onPaired={(node) => {
            setPairing(false)
            void select(node.nodeId)
          }}
        />
      </Show>

      <Show when={selected()}>
        {(node) => (
          <section class="card" aria-label="Projects">
            <h2>Projects on {node().label}</h2>
            <p class="status" data-testid="node-status">
              {statusGuidance(status()).label}
              <Show when={statusGuidance(status()).detail}>{(detail) => <span> · {detail()}</span>}</Show>
            </p>
            <Show
              when={projects()}
              fallback={<p class="quiet">{problem() ? 'Projects are unavailable.' : 'Loading projects…'}</p>}
            >
              {(loaded) => (
                <Show
                  when={loaded().projects.some((project) => !project.hidden)}
                  fallback={<p class="quiet">No projects.</p>}
                >
                  <ul class="projects">
                    <For each={loaded().projects.filter((project) => !project.hidden)}>
                      {(project) => (
                        <li>
                          <strong>{project.name}</strong>
                          <Show when={project.path}>{(path) => <span class="quiet">{path()}</span>}</Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              )}
            </Show>
            <button type="button" class="quiet" onClick={() => void loadProjects(node().nodeId)}>
              Refresh
            </button>
          </section>
        )}
      </Show>
    </main>
  )
}
