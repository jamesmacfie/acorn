import { Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from 'solid-js'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeHandoff,
  BridgeNodes,
  BridgePageTask,
  BridgePanel,
  BridgePendingRequest,
} from '@acorn/protocol/extensionBridge.ts'
import type { PluginIcon } from '@acorn/protocol/plugin/handoffs.ts'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import { conversationLink, taskLink } from '../acornLinks'
import type { BrowserApi } from '../browser'
import { HIDDEN_MARKERS_KEY, type PageHandoff } from '../handoffs'
import { CallFailure, expectedFailure, type CallError, type HostState, type RequestTarget } from '../messages'
import { savePendingItem } from '../localState'
import { pageTasks } from '../taskPages'
import { activePageUrl } from './activePage'
import { bridgeClient } from './bridgeClient'
import type { PageCapture } from '../capture'
import { errorGuidance, hostGuidance, installTitle, statusGuidance } from './guidance'
import { createLocation, type Location } from './location'
import { NeedsYouButton, createRequestReads } from './NeedsYou'
import { InstallBridge, Pairing } from './Pairing'
import { Settings } from './Settings'
import { TopBar, type Heading } from './TopBar'
import { ConversationMenu, TaskMenu } from './TopBarMenus'
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
  // Pairing replaces whatever the panel showed, which returns when it closes. Its step says what the
  // top bar's Cancel does.
  const [pairing, setPairing] = createSignal(false)
  const [pairingCancel, setPairingCancel] = createSignal<(() => void) | null>(null)
  const [hint, setHint] = createSignal<BridgeAgentHint | null>(null)
  // Counts each return of the selected Node's connection. What the sidebar shows may have changed
  // while it was away, and frames missed in a gap are never replayed, so a return means read again.
  const [reconnects, setReconnects] = createSignal(0)
  // Counts changes to the selected Node's projects, made here or by another client.
  const [projectChanges, setProjectChanges] = createSignal(0)
  // The selected Node's handoffs, and the one the person asked for, if any.
  const [handoffs, setHandoffs] = createSignal<BridgeHandoff[]>([])
  // The selected Node's plugin panels, null until it answers.
  const [panels, setPanels] = createSignal<BridgePanel[] | null>(null)
  // Their plugins' logos, registered as `brand:<pluginId>` as the desktop's client registers them, so an
  // item card shows its plugin's logo. A kit mark of the same name, such as GitHub's, stays.
  const [icons, setIcons] = createSignal<PluginIcon[]>([])
  createEffect(() => {
    const marks = icons()
      .filter((icon) => !untrack(() => brandMarkRegistry.get(icon.pluginId)))
      .map(({ pluginId, d, color }) => brandMarkRegistry.register({ id: pluginId, d, color }))
    onCleanup(() => marks.forEach((mark) => mark.dispose()))
  })
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
  // The selected Node's tasks and their page addresses, as the background keeps them: null until the
  // background has read the selected Node's list.
  const [taskPages, setTaskPages] = createSignal<{ nodeId: string | null; tasks: BridgePageTask[] | null }>({
    nodeId: null,
    tasks: null,
  })
  const nodeTasks = () => (taskPages().nodeId === fleet()?.activeNodeId ? taskPages().tasks : null)
  // The apps plugins published for the selected Node's tasks, for site access.
  const apps = () => (nodeTasks() ?? []).flatMap((task) => task.pages.filter((page) => page.status))
  // The tasks the page beside the panel belongs to, and the first of them, which the panel follows.
  const pageTaskList = createMemo(() => pageTasks(nodeTasks() ?? [], pageUrl()))
  const pageTaskId = createMemo(() => pageTaskList()[0]?.task.id ?? null)
  // Where the sidebar is, and what the top bar names under a task or in a conversation.
  const nav = createLocation({
    storage: props.api.storage.local,
    pageTaskId,
    tasks: nodeTasks,
  })
  const [heading, setHeading] = createSignal<Heading | null>(null)
  // Whether Go to task is open, and the top bar it hangs under.
  const [goToTask, setGoToTask] = createSignal(false)
  const [topBar, setTopBar] = createSignal<HTMLElement>()
  // Counts conversations archived here, after which the task's list reads again.
  const [archives, setArchives] = createSignal(0)
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
      nav.goHome()
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
      setPairing(false)
      setOpenRequest(target)
    },
    notice: setNotice,
    taskPages: (nodeId, tasks) => setTaskPages({ nodeId, tasks }),
    // A task chip was clicked: its task opens, on Agents with the page's link waiting for the task's
    // first conversation when they asked for a new chat about the page.
    showTask: async (chat) => {
      setPairing(false)
      const taskId = pageTaskId()
      const nodeId = fleet()?.activeNodeId
      if (!taskId || !nodeId) return nav.goHome()
      if (chat) {
        const link: PageCapture = { kind: 'link', id: crypto.randomUUID(), ...chat, capturedAt: Date.now() }
        // Without room for it, the task still opens; the person can add the page from the composer.
        await savePendingItem(props.api.storage.local, nodeId, taskId, link).catch(() => {})
      }
      nav.openTask(taskId, chat ? 'agents' : undefined)
    },
  })
  const requestReads = createRequestReads(client, requests)
  const selected = () => fleet()?.nodes.find((node) => node.nodeId === fleet()?.activeNodeId) ?? null
  const online = () => host().state === 'connected' && connected(status())

  const attempt = async (work: () => Promise<void>) => {
    setProblem(null)
    try {
      await work()
    } catch (error) {
      if (expectedFailure(error)) return
      setProblem(error instanceof CallFailure ? error : { code: 'node_error', message: String(error) })
    }
  }
  // Read through the background, which keeps the pages' buttons in step with what the sidebar shows.
  const loadHandoffs = async (nodeId: string) => {
    try {
      const result = await client.call({ op: 'handoffs.list', nodeId })
      if (result.nodeId !== fleet()?.activeNodeId) return
      setHandoffs(result.handoffs)
      setPanels(result.panels)
      setIcons(result.icons)
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
    // Before the Node shows, so a conversation a notification asked for opens over the fresh start.
    if (switched) void nav.selectNode(next.activeNodeId)
    setFleet(next)
    showStatus(next.status)
    if (!switched) return
    // A handoff belongs to the Node it was asked of, as the page buttons do.
    setHandoffs([])
    setPanels(null)
    setIcons([])
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
  const rename = (nodeId: string, label: string) =>
    attempt(async () => showFleet(await client.call({ op: 'node.rename', nodeId, label })))

  onMount(() => void refresh())
  // ⌘K, or Ctrl+K, opens Go to task from anywhere in the panel once it has focus.
  const onKey = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    if (fleet()?.activeNodeId && !pairing()) setGoToTask((open) => !open)
  }
  onMount(() => document.addEventListener('keydown', onKey))
  onCleanup(() => document.removeEventListener('keydown', onKey))

  const at = <Level extends Location['level']>(level: Level) => {
    const here = nav.location()
    return here.level === level ? (here as Extract<Location, { level: Level }>) : null
  }
  const archive = (nodeId: string, sessionId: string) =>
    attempt(async () => {
      await client.call({ op: 'session.archive', nodeId, sessionId, key: crypto.randomUUID() })
      setArchives((count) => count + 1)
      if (at('conversation')?.sessionId === sessionId) nav.back()
    })
  // A conversation an OS notification or a right-click asked to open, once its Node is the selected one.
  createEffect(
    on([openRequest, () => fleet()?.activeNodeId], ([target, nodeId]) => {
      if (!target || !nodeId) return
      setOpenRequest(null)
      if (target.nodeId === nodeId) nav.openConversation(target.taskId, target.sessionId)
    }),
  )
  // The panel follows the page as the browser tab moves, and once the Node's task list first arrives.
  // A later list, such as one with a task just made for the page, moves nothing, so Home's card stays.
  // Pairing never moves.
  const tasksKnown = createMemo(() => nodeTasks() !== null)
  createEffect(on([pageUrl, tasksKnown], () => !pairing() && nav.followPage(pageTaskId()), { defer: true }))
  // `acorn browser install` runs in a terminal, so the panel can't see it finish. It asks again until
  // the bridge answers.
  const installing = createMemo(() => installTitle(host()))
  // Getting connected shows a bare top bar: nothing else works without a bridge and a Node.
  const connecting = () => !!installing() || pairing()
  createEffect(() => {
    if (!installing()) return
    const timer = setInterval(() => void refresh(), BRIDGE_RECHECK_MS)
    onCleanup(() => clearInterval(timer))
  })
  const offline = () => status()?.state === 'offline'
  return (
    <main>
      <TopBar
        location={nav.location()}
        bare={connecting()}
        cancel={pairing() ? (pairingCancel() ?? undefined) : undefined}
        heading={heading()}
        nodeLabel={selected()?.label ?? null}
        status={status()}
        ref={setTopBar}
        back={nav.back}
        openSettings={() => {
          setPairing(false)
          nav.openSettings()
        }}
        goToTask={() => setGoToTask(true)}
        needsYou={
          <Show when={fleet()?.activeNodeId} keyed>
            {(nodeId) => (
              <NeedsYouButton
                client={client}
                nodeId={nodeId}
                requests={requests().nodeId === nodeId ? requests().requests : []}
                reads={requestReads}
                online={online()}
                openConversation={nav.openConversation}
              />
            )}
          </Show>
        }
        menu={
          <Show when={fleet()?.activeNodeId}>
            {(nodeId) => (
              <Switch>
                <Match when={at('task')}>
                  {(here) => (
                    <TaskMenu
                      api={props.api}
                      href={taskLink(nodeId(), here().taskId)}
                      opensLinks={props.opensLinks ?? false}
                      pages={nodeTasks()?.find((task) => task.id === here().taskId)?.pages ?? []}
                      pageUrl={pageUrl()}
                      openSettings={nav.openSettings}
                    />
                  )}
                </Match>
                <Match when={at('conversation')}>
                  {(here) => (
                    <ConversationMenu
                      href={conversationLink(nodeId(), here().taskId, here().sessionId)}
                      opensLinks={props.opensLinks ?? false}
                      archive={() => void archive(nodeId(), here().sessionId)}
                    />
                  )}
                </Match>
              </Switch>
            )}
          </Show>
        }
      />
      {/* One line for anything wrong with the bridge or the Node, with the next step. */}
      <Show when={hostGuidance(host())}>
        {(guidance) => (
          <div class="banner problem row" role="alert">
            <span class="grow">{guidance()}</span>
            <Button label="Retry" onPress={() => void refresh()} />
          </div>
        )}
      </Show>
      <Show when={host().restoreError}>{(message) => <p class="banner notice">{message()}</p>}</Show>
      <Show when={notice()}>
        {(message) => (
          <div class="banner notice row" role="status">
            <span class="grow">{message()}</span>
            <Button label="Dismiss" onPress={() => setNotice(null)} />
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
      {/* The selected Node can't be worked with. What the panel shows stays readable under the strip. */}
      <Show when={!connecting() && selected() && statusGuidance(status()).detail}>
        {(detail) => (
          <div class="strip" data-tone="bad" role="status" data-testid="node-status">
            <Icon name="circle-x" tone="danger" />
            <span class="grow">
              <Show when={offline()} fallback={detail()}>
                <b>{selected()!.label}</b> is offline
              </Show>
            </span>
            <Show when={offline()}>
              <Button label="Retry" onPress={() => void refresh()} />
            </Show>
          </div>
        )}
      </Show>
      <Show when={fleet() && !fleet()!.activeNodeId && nav.location().level !== 'settings' && !connecting()}>
        <div class="banner notice row">
          <span class="grow">
            {fleet()!.nodes.length ? 'Choose a Node to work with.' : 'No Node is paired with this browser yet.'}
          </span>
          <Button
            label={fleet()!.nodes.length ? 'Choose a Node' : 'Pair a Node'}
            variant="solid"
            tone="accent"
            onPress={() => (fleet()!.nodes.length ? nav.openSettings() : setPairing(true))}
          />
        </div>
      </Show>

      <Show
        when={!connecting()}
        fallback={
          <Show
            when={installing()}
            fallback={
              <Pairing
                api={props.api}
                client={client}
                fleet={fleet()}
                handoffs={handoffs()}
                paired={(node) => void select(node.nodeId)}
                showCancel={(cancel) => setPairingCancel(() => cancel)}
                close={() => setPairing(false)}
                done={() => {
                  setPairing(false)
                  nav.goHome()
                }}
              />
            }
          >
            {(title) => <InstallBridge title={title()} />}
          </Show>
        }
      >
        {/* Settings shows over the Workspace, which stays mounted so the task it showed is there on Back. */}
        <Show when={nav.location().level === 'settings'}>
          <Settings
            api={props.api}
            client={client}
            fleet={fleet()}
            online={online()}
            pair={() => setPairing(true)}
            select={(nodeId) => void select(nodeId)}
            rename={(nodeId, label) => void rename(nodeId, label)}
            forget={(nodeId) => void forget(nodeId)}
            handoffs={handoffs()}
            sites={sites()}
            apps={apps()}
            pageUrl={pageUrl()}
            sitesChanged={(projectId, changed) => {
              const nodeId = fleet()?.activeNodeId
              if (nodeId) sitesChanged(nodeId, projectId, changed)
            }}
          />
        </Show>
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
              nav={nav}
              heading={setHeading}
              goToTask={goToTask()}
              closeGoToTask={() => setGoToTask(false)}
              topBar={topBar()}
              nodeLabel={selected()?.label ?? ''}
              status={status()}
              archives={archives()}
              panels={panels()}
              pageUrl={pageUrl()}
              handoffs={handoffs()}
              sites={sites()}
              tasks={nodeTasks()}
              pageTasks={pageTaskList()}
              markerHidden={(origin) => hiddenMarkers().includes(origin)}
              showMarker={(origin) =>
                void props.api.storage.local.set({
                  [HIDDEN_MARKERS_KEY]: hiddenMarkers().filter((hidden) => hidden !== origin),
                })
              }
              handoff={handoff()}
              startHandoff={setHandoff}
              dismissHandoff={() => setHandoff(null)}
              requests={requests().nodeId === nodeId ? requests().requests : []}
              requestReads={requestReads}
            />
          )}
        </Show>
      </Show>
    </main>
  )
}
