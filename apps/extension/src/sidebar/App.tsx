import { For, Show, createSignal, onMount } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeAgentHint, BridgeNodes } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure, type CallError, type HostState } from '../messages'
import { bridgeClient } from './bridgeClient'
import { capturePage } from './capture'
import { errorGuidance, hostGuidance, statusGuidance } from './guidance'
import { Destination } from './Destination'
import { Pairing } from './Pairing'

// Online, or online with live updates paused: either way the Node answers requests.
const connected = (status: NodeStatus | null) => status?.state === 'online' || status?.state === 'degraded'

export function App(props: { api: BrowserApi }) {
  const [host, setHost] = createSignal<HostState>({ state: 'connecting', message: null, restoreError: null })
  const [fleet, setFleet] = createSignal<BridgeNodes | null>(null)
  const [status, setStatus] = createSignal<NodeStatus | null>(null)
  const [problem, setProblem] = createSignal<CallError | null>(null)
  const [pairing, setPairing] = createSignal(false)
  const [hint, setHint] = createSignal<BridgeAgentHint | null>(null)
  // Counts each return of the selected Node's connection. What the sidebar shows may have changed
  // while it was away, and frames missed in a gap are never replayed, so a return means read again.
  const [reconnects, setReconnects] = createSignal(0)

  const showStatus = (next: NodeStatus | null) => {
    const wasUp = connected(status())
    setStatus(next)
    if (!wasUp && connected(next)) setReconnects((count) => count + 1)
  }
  const client = bridgeClient(props.api, {
    host: setHost,
    // Only the selected Node's status matters, and only while it is still selected.
    status: (next) => next.nodeId === fleet()?.activeNodeId && showStatus(next),
    agents: (next) => next.nodeId === fleet()?.activeNodeId && setHint(next),
  })
  const selected = () => fleet()?.nodes.find((node) => node.nodeId === fleet()?.activeNodeId) ?? null
  const online = () => host().state === 'connected' && connected(status())

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
    showStatus(next.status)
  }
  const refresh = () => attempt(async () => showFleet(await client.call({ op: 'nodes.list' })))
  const select = (nodeId: string | null) =>
    attempt(async () => showFleet(await client.call({ op: 'node.select', nodeId })))
  const forget = (nodeId: string) => attempt(async () => showFleet(await client.call({ op: 'node.forget', nodeId })))

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
          <section class="card" aria-label="Selected Node">
            <h2>{node().label}</h2>
            <p class="status" data-testid="node-status">
              {statusGuidance(status()).label}
              <Show when={statusGuidance(status()).detail}>{(detail) => <span> · {detail()}</span>}</Show>
            </p>
          </section>
        )}
      </Show>
      <Show when={fleet()?.activeNodeId} keyed>
        {(nodeId) => (
          <Destination
            client={client}
            storage={props.api.storage.local}
            nodeId={nodeId}
            nodeLabel={selected()?.label ?? nodeId}
            online={online()}
            hint={hint()}
            reconnects={reconnects()}
            capture={(kind) => capturePage(props.api, kind)}
          />
        )}
      </Show>
    </main>
  )
}
