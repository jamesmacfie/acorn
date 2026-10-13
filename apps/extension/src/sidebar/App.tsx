import { For, Show, createSignal, onMount } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeHandoff,
  BridgeNodes,
  BridgePendingRequest,
} from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from '../browser'
import type { PageHandoff } from '../handoffs'
import { CallFailure, type CallError, type HostState, type RequestTarget } from '../messages'
import { activePageUrl } from './activePage'
import { bridgeClient } from './bridgeClient'
import { capturePage } from './capture'
import { errorGuidance, hostGuidance, statusGuidance } from './guidance'
import { Destination } from './Destination'
import { Pairing } from './Pairing'
import { SiteAccess } from './SiteAccess'

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
  // The selected Node's handoffs, and the one the person asked for, if any.
  const [handoffs, setHandoffs] = createSignal<BridgeHandoff[]>([])
  const [handoff, setHandoff] = createSignal<PageHandoff | null>(null)
  // Counts toolbar clicks, after which the active page may be readable where it wasn't.
  const [pageChecks, setPageChecks] = createSignal(0)
  const pageUrl = activePageUrl(props.api, pageChecks)
  // The selected Node's project site associations, matched against the page here in the browser.
  const [sites, setSites] = createSignal<ProjectSite[]>([])
  // What the selected Node's agents are waiting on, as the background reads it for the badge, and a
  // conversation an OS notification asked to open.
  const [requests, setRequests] = createSignal<{ nodeId: string | null; requests: BridgePendingRequest[] }>({
    nodeId: null,
    requests: [],
  })
  const [openRequest, setOpenRequest] = createSignal<RequestTarget | null>(null)

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
    handoff: setHandoff,
    handoffsChanged: (nodeId) => nodeId === fleet()?.activeNodeId && void loadHandoffs(nodeId),
    projectsChanged: (nodeId) => nodeId === fleet()?.activeNodeId && void loadSites(nodeId),
    page: () => setPageChecks((count) => count + 1),
    requests: (nodeId, list) => setRequests({ nodeId, requests: list }),
    open: setOpenRequest,
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
  // Read through the background, which keeps the pages' buttons in step with what the sidebar shows.
  const loadHandoffs = async (nodeId: string) => {
    try {
      const result = await client.call({ op: 'handoffs.list', nodeId })
      if (result.nodeId === fleet()?.activeNodeId) setHandoffs(result.handoffs)
    } catch {
      // Without the list the sidebar offers no handoff; pairing and conversations still work.
    }
  }
  const loadSites = async (nodeId: string) => {
    try {
      const result = await client.call({ op: 'sites.list', nodeId })
      if (result.nodeId === fleet()?.activeNodeId) setSites(result.sites)
    } catch {
      // Without them the sidebar suggests no project; every other choice still works.
    }
  }
  // A change the sidebar made itself, answered with the Node's list for that project.
  const sitesChanged = (nodeId: string, projectId: string, changed: SiteAssociation[]) => {
    if (nodeId !== fleet()?.activeNodeId) return
    setSites((current) => [
      ...current.filter((site) => site.projectId !== projectId),
      ...changed.map((site) => ({ projectId, ...site })),
    ])
  }
  const showFleet = (next: BridgeNodes) => {
    const switched = next.activeNodeId !== fleet()?.activeNodeId
    setFleet(next)
    showStatus(next.status)
    if (!switched) return
    // A handoff belongs to the Node it was asked of, as the page buttons do.
    setHandoffs([])
    setHandoff(null)
    setSites([])
    if (next.activeNodeId) {
      void loadHandoffs(next.activeNodeId)
      void loadSites(next.activeNodeId)
    }
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
      <Show when={fleet()?.activeNodeId}>
        <SiteAccess api={props.api} handoffs={handoffs()} sites={sites()} pageUrl={pageUrl()} start={setHandoff} />
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
            handoff={handoff()}
            dismissHandoff={() => setHandoff(null)}
            pageUrl={pageUrl()}
            sites={sites()}
            sitesChanged={(projectId, changed) => sitesChanged(nodeId, projectId, changed)}
            permissions={props.api.permissions}
            requests={requests().nodeId === nodeId ? requests().requests : []}
            openRequest={openRequest()}
            openedRequest={() => setOpenRequest(null)}
          />
        )}
      </Show>
    </main>
  )
}
