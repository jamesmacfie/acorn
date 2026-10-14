import type { NodeStatus } from '@acorn/protocol/broker.ts'
import {
  BROWSER_BRIDGE_HOST,
  type BridgeNodes,
  type BridgeOperation,
  type BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Port, Tab } from '../browser'
import type { PageHandoff } from '../handoffs'
import { CallFailure, type BackgroundMessage, type BridgeCall, type HostState, type SidebarMessage } from '../messages'
import { appTask, pageTasks } from '../taskPages'
import { askElement } from './askElement'
import { nativeBridge } from './nativeBridge'
import { requestBadge } from './requestBadge'
import { selectionMenu } from './selectionMenu'
import { siteButtons } from './siteButtons'
import { appMarker, chipTask, taskPages } from './taskPages'

// The selected Node, remembered by this browser profile. The native host holds the selection only
// while it runs, so the background selects it again each time the host starts.
export const SELECTED_NODE_KEY = 'selectedNodeId'

// The background: one native connection, shared by every open sidebar. It adds nothing to an
// operation except restoring the selection first and remembering a new one afterwards. It opens the
// connection as it starts when a Node is selected, so the toolbar badge works with the sidebar closed.
// An open native port keeps the background running in both browsers; once a port closes, the
// background may stop, and its next start connects again.
export function startBackground(api: BrowserApi, hostName: string): void {
  const sidebars = new Set<Port>()
  let host: HostState = { state: 'connecting', message: null, restoreError: null }
  const broadcast = (message: BackgroundMessage): void => {
    for (const port of sidebars) port.postMessage(message)
  }
  const setHost = (next: Partial<HostState>): void => {
    const merged = { ...host, ...next }
    if (merged.state === host.state && merged.message === host.message && merged.restoreError === host.restoreError)
      return
    host = merged
    broadcast({ type: 'host', host })
  }

  // Clicks waiting for a sidebar to take them, the latest of each kind: a page to hand off, a task to
  // show, a conversation to open, or why a right-click added nothing. A panel opened by the click
  // connects a moment later, and gets them then.
  let waiting: BackgroundMessage[] = []
  const offer = (message: Extract<BackgroundMessage, { type: 'handoff' | 'showTask' | 'open' | 'notice' }>): void => {
    waiting = sidebars.size ? [] : [...waiting.filter((other) => other.type !== message.type), message]
    broadcast(message)
  }
  // Whether the host was started again on its own since the person last used the sidebar.
  let restartedHost = false

  // Each browser's open call runs inside the person's click, where the gesture counts.
  const openPanel = (tab: Tab): void => {
    const opened = api.sidePanel ? api.sidePanel.open({ windowId: tab.windowId }) : api.sidebarAction?.open()
    // Refused outside a gesture the browser counts, as a notification click may be.
    opened?.catch(() => undefined)
  }
  const buttons = siteButtons(api, {
    open: openPanel,
    clicked: (handoff: PageHandoff) => offer({ type: 'handoff', handoff }),
    showTask: (chat) => offer({ type: 'showTask', chat }),
    chip: (url) => {
      const [match] = pageTasks(pages.tasks, url)
      const nodeId = buttons.nodeId
      if (!match || !nodeId) return null
      const chip = chipTask(nodeId, match, pages.sessions(match.task.id), badge.current.requests)
      return { taskId: match.task.id, chip }
    },
    marker: (url) => {
      const match = appTask(pages.tasks, url)
      const nodeId = buttons.nodeId
      return match && nodeId ? appMarker(nodeId, match) : null
    },
    follow: (taskIds) => pages.follow(taskIds),
    // Only a release desktop registers `acorn://`, as in the sidebar.
    opensLinks: hostName === BROWSER_BRIDGE_HOST,
  })

  const bridge = nativeBridge(api, hostName, {
    status: (status) => {
      broadcast({ type: 'status', status })
      badge.status(status)
      pages.status(status)
    },
    agents: (hint) => {
      broadcast({ type: 'agent', hint })
      badge.hint(hint)
      pages.hint(hint)
    },
    handoffs: (nodeId) => {
      broadcast({ type: 'handoffs', nodeId })
      void refreshHandoffs(nodeId)
    },
    projects: (nodeId) => {
      broadcast({ type: 'projects', nodeId })
      badge.projectsChanged(nodeId)
      pages.changedOn(nodeId)
    },
    tasks: (nodeId) => pages.changedOn(nodeId),
    host: (state) => {
      const wasConnected = host.state === 'connected'
      setHost(state)
      if (state.state === 'connected') return
      badge.hostDown()
      pages.hostDown()
      // A host that stopped after working is started once more, so the badge comes back with the
      // sidebar closed. A second stop waits for the person, so a host that keeps failing can't loop.
      if (wasConnected && state.state === 'exited' && !restartedHost) {
        restartedHost = true
        restoring = restoring.then(() => (bridge.closed ? restoreSelection() : undefined))
      }
    },
  })

  // The selected Node's handoffs, read again after a selection, a restore, or a plugin change. A list
  // for a Node that is no longer selected is dropped.
  const refreshHandoffs = async (nodeId: string): Promise<void> => {
    try {
      const result = await bridge.request({ op: 'handoffs.list', nodeId })
      if (buttons.nodeId === nodeId) await buttons.update({ nodeId, handoffs: result.handoffs })
    } catch {
      // The buttons stay as they were; the next selection or plugin change reads again.
    }
  }
  // `status` is the Node's connection as the selection reply reported it, which may have changed
  // before the background knew which Node to listen for.
  const selected = async (nodeId: string | null, status: NodeStatus | null = null): Promise<void> => {
    if (status) {
      badge.status(status)
      pages.status(status)
    }
    void badge.select(nodeId)
    void pages.select(nodeId)
    await buttons.select(nodeId)
    if (nodeId) void refreshHandoffs(nodeId)
  }

  // A failed restore is reported, not thrown: pairing and forgetting must still work when the
  // remembered Node was forgotten elsewhere or lost its credential.
  const restoreSelection = async (): Promise<void> => {
    const stored = (await api.storage.local.get([SELECTED_NODE_KEY]))[SELECTED_NODE_KEY]
    if (typeof stored !== 'string') return setHost({ restoreError: null })
    // A second attempt on a fresh port when the first port closed, as one that never answered is.
    for (let attempt = 1; ; attempt++) {
      try {
        const nodes = await bridge.request({ op: 'node.select', nodeId: stored })
        void selected(stored, nodes.status)
        return setHost({ restoreError: null })
      } catch (error) {
        const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
        if (failure.code === 'host_unavailable' && attempt < 2) continue
        if (failure.code === 'unknown_node') {
          await api.storage.local.remove([SELECTED_NODE_KEY])
          void selected(null)
        }
        if (failure.code !== 'host_unavailable')
          setHost({ restoreError: `Could not reselect the last Node: ${failure.message}` })
        return
      }
    }
  }

  let restoring = restoreSelection()
  const call = async (operation: BridgeCall): Promise<unknown> => {
    // After the restore already under way, so two can't run at once.
    if (bridge.closed) restoring = restoring.then(() => (bridge.closed ? restoreSelection() : undefined))
    await restoring
    const result = await bridge.request(operation)
    if (operation.op === 'node.select' || operation.op === 'node.forget') {
      const { activeNodeId } = result as BridgeNodes
      if (activeNodeId) await api.storage.local.set({ [SELECTED_NODE_KEY]: activeNodeId })
      else await api.storage.local.remove([SELECTED_NODE_KEY])
      setHost({ restoreError: null })
      void selected(activeNodeId, (result as BridgeNodes).status)
    } else if (operation.op === 'nodes.list') {
      const { activeNodeId, status } = result as BridgeNodes
      void selected(activeNodeId, status)
    }
    // The sidebar's own read keeps the pages' buttons current too.
    if (operation.op === 'handoffs.list') {
      const { nodeId, handoffs } = result as BridgeResults['handoffs.list']
      if (buttons.nodeId === nodeId) await buttons.update({ nodeId, handoffs })
    }
    return result
  }

  const read = <Op extends BridgeOperation>(operation: Extract<BridgeCall, { op: Op }>) =>
    call(operation) as Promise<BridgeResults[Op]>
  const badge = requestBadge(api, {
    read,
    // A chip counts the agents waiting on the person too.
    broadcast: (message) => {
      broadcast(message)
      void buttons.redraw()
    },
    open: (target) => {
      offer({ type: 'open', target })
      void api.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && openPanel(tab))
    },
    pageTaskIds: (url) => pageTasks(pages.tasks, url).map(({ task }) => task.id),
  })
  const pages = taskPages({
    read,
    broadcast: (message) => {
      broadcast(message)
      badge.tasksChanged()
    },
    changed: () => void buttons.redraw(),
  })

  selectionMenu(api, {
    open: openPanel,
    // The Node a restore under way may still drop, as it does one forgotten elsewhere.
    selectedNode: async () => {
      await restoring
      const stored = (await api.storage.local.get([SELECTED_NODE_KEY]))[SELECTED_NODE_KEY]
      return typeof stored === 'string' ? stored : null
    },
    read,
    added: (target) => offer({ type: 'open', target }),
    refused: (notice) => offer({ type: 'notice', notice }),
  })
  askElement(api, {
    open: openPanel,
    selectedNode: () => buttons.nodeId,
    // The first, as the chip shows.
    pageTask: (url) => pageTasks(pages.tasks, url)[0] ?? null,
    sessions: (taskId) => pages.sessions(taskId),
    read,
    refused: (notice) => offer({ type: 'notice', notice }),
    sent: (target) => offer({ type: 'open', target }),
  })

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidebar') return
    sidebars.add(port)
    port.postMessage({ type: 'host', host } satisfies BackgroundMessage)
    port.postMessage(badge.current)
    port.postMessage(pages.current)
    for (const message of waiting) port.postMessage(message)
    waiting = []
    port.onDisconnect.addListener(() => sidebars.delete(port))
    port.onMessage.addListener((raw) => {
      const message = raw as SidebarMessage
      if (typeof message?.id !== 'string' || typeof message.call?.op !== 'string') return
      restartedHost = false
      call(message.call).then(
        (result) => port.postMessage({ type: 'reply', id: message.id, ok: true, result } satisfies BackgroundMessage),
        (error: unknown) => {
          const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
          port.postMessage({
            type: 'reply',
            id: message.id,
            ok: false,
            error: { code: failure.code, message: failure.message },
          } satisfies BackgroundMessage)
        },
      )
    })
  })

  // The toolbar button opens the sidebar and lets the extension read the page it was clicked on: a
  // click the extension handles itself grants `activeTab`. Chrome's own open-on-click grants nothing,
  // so it stays off, and each browser's open call runs inside the click, where the gesture counts.
  // Opening rather than toggling keeps the panel up when the person clicks again to capture a page.
  if (api.sidePanel) void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
  api.action.onClicked.addListener((tab) => {
    openPanel(tab)
    // The click grants this tab's access, so a matching page gets its buttons without a site grant.
    if (tab.id !== undefined) {
      void buttons.syncTab(tab.id, tab.url)
      badge.tabGranted(tab.id, tab.url)
    }
    broadcast({ type: 'page' })
  })
}
