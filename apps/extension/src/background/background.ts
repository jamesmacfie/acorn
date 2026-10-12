import type { BridgeNodes } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Port } from '../browser'
import { CallFailure, type BackgroundMessage, type BridgeCall, type HostState, type SidebarMessage } from '../messages'
import { nativeBridge } from './nativeBridge'

// The selected Node, remembered by this browser profile. The native host holds the selection only
// while it runs, so the background selects it again each time the host starts.
export const SELECTED_NODE_KEY = 'selectedNodeId'

// The background: one native connection, shared by every open sidebar. It adds nothing to an
// operation except restoring the selection first and remembering a new one afterwards.
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

  const bridge = nativeBridge(api, hostName, {
    status: (status) => broadcast({ type: 'status', status }),
    agents: (hint) => broadcast({ type: 'agent', hint }),
    host: (state) => setHost(state),
  })

  // A failed restore is reported, not thrown: pairing and forgetting must still work when the
  // remembered Node was forgotten elsewhere or lost its credential.
  const restoreSelection = async (): Promise<void> => {
    const stored = (await api.storage.local.get([SELECTED_NODE_KEY]))[SELECTED_NODE_KEY]
    if (typeof stored !== 'string') return setHost({ restoreError: null })
    // A second attempt on a fresh port when the first port closed, as one that never answered is.
    for (let attempt = 1; ; attempt++) {
      try {
        await bridge.request({ op: 'node.select', nodeId: stored })
        return setHost({ restoreError: null })
      } catch (error) {
        const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
        if (failure.code === 'host_unavailable' && attempt < 2) continue
        if (failure.code === 'unknown_node') await api.storage.local.remove([SELECTED_NODE_KEY])
        if (failure.code !== 'host_unavailable')
          setHost({ restoreError: `Could not reselect the last Node: ${failure.message}` })
        return
      }
    }
  }

  let restoring: Promise<void> = Promise.resolve()
  const call = async (operation: BridgeCall): Promise<unknown> => {
    if (bridge.closed) restoring = restoreSelection()
    await restoring
    const result = await bridge.request(operation)
    if (operation.op === 'node.select' || operation.op === 'node.forget') {
      const { activeNodeId } = result as BridgeNodes
      if (activeNodeId) await api.storage.local.set({ [SELECTED_NODE_KEY]: activeNodeId })
      else await api.storage.local.remove([SELECTED_NODE_KEY])
      setHost({ restoreError: null })
    }
    return result
  }

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidebar') return
    sidebars.add(port)
    port.postMessage({ type: 'host', host } satisfies BackgroundMessage)
    port.onDisconnect.addListener(() => sidebars.delete(port))
    port.onMessage.addListener((raw) => {
      const message = raw as SidebarMessage
      if (typeof message?.id !== 'string' || typeof message.call?.op !== 'string') return
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
    if (api.sidePanel) void api.sidePanel.open({ windowId: tab.windowId })
    else void api.sidebarAction?.open()
  })
}
