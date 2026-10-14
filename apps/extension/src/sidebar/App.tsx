import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeHandoff,
  BridgeNodes,
  BridgePageTask,
  BridgePendingRequest,
} from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from '../browser'
import { HIDDEN_MARKERS_KEY, type PageHandoff } from '../handoffs'
import { CallFailure, type CallError, type HostState, type RequestTarget } from '../messages'
import { pageTasks } from '../taskPages'
import { activePageUrl } from './activePage'
import { bridgeClient } from './bridgeClient'
import { capturePage, type PageCapture } from '../capture'
import { INSTALL_COMMAND, errorGuidance, hostGuidance, installFixes, statusGuidance } from './guidance'
import { Header } from './Header'
import { Pairing } from './Pairing'
import { Settings } from './Settings'
import { Workspace } from './Workspace'

// How often the panel asks again for a bridge the person is installing.
const BRIDGE_RECHECK_MS = 3_000

// Online, or online with live updates paused: either way the Node answers requests.
const connected = (status: NodeStatus | null) => status?.state === 'online' || status?.state === 'degraded'

// `opensLinks` says whether this build runs beside a desktop that opens `acorn://` links.
export function App(props: { api: BrowserApi; opensLinks?: boolean }) {
  const [host, setHost] = createSignal<HostState>({ state: 'connecting', message: null, restoreError: null })
  const [fleet, setFleet] = createSignal<BridgeNodes | null>(null)
  const [status, setStatus] = createSignal<NodeStatus | null>(null)
  const [problem, setProblem] = createSignal<CallError | null>(null)
  // Pairing replaces whatever the panel showed, which returns when it closes.
  const [pairing, setPairing] = createSignal(false)
  const [hint, setHint] = createSignal<BridgeAgentHint | null>(null)
  // Counts each return of the selected Node's connection. What the sidebar shows may have changed
  // while it was away, and frames missed in a gap are never replayed, so a return means read again.
  const [reconnects, setReconnects] = createSignal(0)
  // Counts changes to the selected Node's projects, made here or by another client.
  const [projectChanges, setProjectChanges] = createSignal(0)
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
  // Why the page's right-click entry added nothing, until the person dismisses it or it works.
  const [notice, setNotice] = createSignal<string | null>(null)
  // The selected Node's tasks and their page addresses, as the background keeps them, and a task chip's
  // click asking Home to show the page's task.
  const [taskPages, setTaskPages] = createSignal<{ nodeId: string | null; tasks: BridgePageTask[] }>({
    nodeId: null,
    tasks: [],
  })
  // The apps plugins published for the selected Node's tasks, for site access.
  const apps = () =>
    taskPages().nodeId === fleet()?.activeNodeId
      ? taskPages().tasks.flatMap((task) => task.pages.filter((page) => page.status))
      : []
  const [showTask, setShowTask] = createSignal<{ chat: { url: string; title: string } | null } | null>(null)
  // A handed-off item's context, kept here so it outlives a visit to Settings' task search.
  const [waitingContext, setWaitingContext] = createSignal<PageCapture | null>(null)
  // Settings replaces Home or the open conversation, which restores from storage when it closes.
  const [settings, setSettings] = createSignal(false)
  // The origins the branch marker is hidden on. Its own menu hides it, and This page shows it again.
  const [hiddenMarkers, setHiddenMarkers] = createSignal<string[]>([])
  const readHiddenMarkers = (value: unknown) =>
    setHiddenMarkers(Array.isArray(value) ? value.filter((origin) => typeof origin === 'string') : [])
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && HIDDEN_MARKERS_KEY in changes) readHiddenMarkers(changes[HIDDEN_MARKERS_KEY]?.newValue)
  }
  onMount(() => {
    void props.api.storage.local
      .get([HIDDEN_MARKERS_KEY])
      .then((stored) => readHiddenMarkers(stored[HIDDEN_MARKERS_KEY]))
    props.api.storage.onChanged.addListener(onStorage)
  })
  onCleanup(() => props.api.storage.onChanged.removeListener(onStorage))

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
    handoff: (next) => {
      setHandoff(next)
      setSettings(false)
    },
    handoffsChanged: (nodeId) => nodeId === fleet()?.activeNodeId && void loadHandoffs(nodeId),
    projectsChanged: (nodeId) => {
      if (nodeId !== fleet()?.activeNodeId) return
      setProjectChanges((count) => count + 1)
      void loadSites(nodeId)
    },
    page: () => setPageChecks((count) => count + 1),
    requests: (nodeId, list) => setRequests({ nodeId, requests: list }),
    open: (target) => {
      setNotice(null)
      setOpenRequest(target)
      setSettings(false)
    },
    notice: setNotice,
    taskPages: (nodeId, tasks) => setTaskPages({ nodeId, tasks }),
    showTask: (chat) => {
      setShowTask({ chat })
      setSettings(false)
      setPairing(false)
    },
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
    // The first answer from a bridge with nothing paired opens pairing, which is all there is to do.
    if (!fleet() && !next.nodes.length) setPairing(true)
    setFleet(next)
    showStatus(next.status)
    if (!switched) return
    // A handoff belongs to the Node it was asked of, as the page buttons do.
    setHandoffs([])
    setHandoff(null)
    setWaitingContext(null)
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
  // `acorn browser install` runs in a terminal, so the panel can't see it finish. It asks again until
  // the bridge answers; Retry stays for the impatient.
  const awaitingInstall = createMemo(() => installFixes(host()))
  createEffect(() => {
    if (!awaitingInstall()) return
    const timer = setInterval(() => void refresh(), BRIDGE_RECHECK_MS)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <main>
      <Header
        fleet={fleet()}
        status={status()}
        settingsOpen={settings()}
        select={(nodeId) => void select(nodeId)}
        pair={() => setPairing(true)}
        forget={(nodeId) => void forget(nodeId)}
        toggleSettings={() => {
          setPairing(false)
          setSettings((open) => !open)
        }}
      />
      {/* One line for anything wrong with the bridge or the Node, with the next step. */}
      <Show when={hostGuidance(host())}>
        {(guidance) => (
          <div class="banner problem row" role="alert">
            <span class="grow">{guidance()}</span>
            <button type="button" class="quiet" onClick={() => void refresh()}>
              Retry
            </button>
            <Show when={awaitingInstall()}>
              <div class="command row">
                <code class="grow">{INSTALL_COMMAND}</code>
                <button
                  type="button"
                  class="quiet"
                  onClick={() => void navigator.clipboard.writeText(INSTALL_COMMAND).catch(() => {})}
                >
                  Copy
                </button>
              </div>
              <p class="quiet">The panel checks again every few seconds and carries on once the bridge answers.</p>
            </Show>
          </div>
        )}
      </Show>
      <Show when={host().restoreError}>{(message) => <p class="banner notice">{message()}</p>}</Show>
      <Show when={notice()}>
        {(message) => (
          <div class="banner notice row" role="status">
            <span class="grow">{message()}</span>
            <button type="button" class="quiet" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
      </Show>
      <Show when={problem()}>
        {(error) => (
          <p class="banner problem" role="alert">
            {errorGuidance(error())}
          </p>
        )}
      </Show>
      <Show when={selected() && statusGuidance(status()).detail}>
        {(detail) => (
          <p class="banner problem" data-testid="node-status">
            {detail()}
          </p>
        )}
      </Show>
      <Show when={fleet() && !fleet()!.activeNodeId && !settings() && !pairing()}>
        <div class="banner notice row">
          <span class="grow">
            {fleet()!.nodes.length ? 'Choose a Node to work with.' : 'No Node is paired with this browser yet.'}
          </span>
          <button type="button" onClick={() => (fleet()!.nodes.length ? setSettings(true) : setPairing(true))}>
            {fleet()!.nodes.length ? 'Choose a Node' : 'Pair a Node'}
          </button>
        </div>
      </Show>

      <Show
        when={!pairing()}
        fallback={
          <Pairing
            api={props.api}
            client={client}
            fleet={fleet()}
            handoffs={handoffs()}
            use={(nodeId) => {
              setPairing(false)
              void select(nodeId)
            }}
            paired={(node) => void select(node.nodeId)}
            close={() => setPairing(false)}
          />
        }
      >
        <Show
          when={settings()}
          fallback={
            <Show when={fleet()?.activeNodeId} keyed>
              {(nodeId) => (
                <Workspace
                  client={client}
                  api={props.api}
                  nodeId={nodeId}
                  online={online()}
                  opensLinks={props.opensLinks ?? false}
                  hint={hint()}
                  reconnects={reconnects()}
                  projectChanges={projectChanges()}
                  capture={(kind) => capturePage(props.api, kind)}
                  pageUrl={pageUrl()}
                  handoffs={handoffs()}
                  sites={sites()}
                  apps={apps()}
                  sitesChanged={(projectId, changed) => sitesChanged(nodeId, projectId, changed)}
                  pageTasks={pageTasks(taskPages().nodeId === nodeId ? taskPages().tasks : [], pageUrl())}
                  markerHidden={(origin) => hiddenMarkers().includes(origin)}
                  showMarker={(origin) =>
                    void props.api.storage.local.set({
                      [HIDDEN_MARKERS_KEY]: hiddenMarkers().filter((hidden) => hidden !== origin),
                    })
                  }
                  showTask={showTask()}
                  shownTask={() => setShowTask(null)}
                  handoff={handoff()}
                  startHandoff={setHandoff}
                  dismissHandoff={() => setHandoff(null)}
                  waitingContext={waitingContext()}
                  setWaitingContext={setWaitingContext}
                  findTask={() => setSettings(true)}
                  requests={requests().nodeId === nodeId ? requests().requests : []}
                  openRequest={openRequest()}
                  openedRequest={() => setOpenRequest(null)}
                />
              )}
            </Show>
          }
        >
          <Settings
            api={props.api}
            client={client}
            fleet={fleet()}
            online={online()}
            pair={() => setPairing(true)}
            select={(nodeId) => void select(nodeId)}
            forget={(nodeId) => void forget(nodeId)}
            handoffs={handoffs()}
            sites={sites()}
            apps={apps()}
            pageUrl={pageUrl()}
            sitesChanged={(projectId, changed) => {
              const nodeId = fleet()?.activeNodeId
              if (nodeId) sitesChanged(nodeId, projectId, changed)
            }}
            close={() => setSettings(false)}
          />
        </Show>
      </Show>
    </main>
  )
}
