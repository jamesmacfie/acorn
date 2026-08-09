import { contextBridge, ipcRenderer } from 'electron'

// Narrow capability surface (docs/electron.md §4g): a desktop marker, the node-broker primitives, and
// the validated terminal channels (docs/terminal-and-agents.md) — never raw ipcRenderer.
contextBridge.exposeInMainWorld('acorn', {
  desktop: true,
  platform: process.platform,
  // Cmd/Ctrl+W → close the focused pane (terminal tab / editor file), never the window. Main
  // suppresses the native accelerator and pings here; the pane that owns focus handles it.
  onClosePane: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('acorn:close-pane', listener)
    return () => ipcRenderer.removeListener('acorn:close-pane', listener)
  },
  onWillQuit: (cb: () => boolean | Promise<boolean>) => {
    const listener = () => {
      void Promise.resolve(cb()).then((approved) => ipcRenderer.send('acorn:quit-response', approved)).catch(() => ipcRenderer.send('acorn:quit-response', false))
    }
    ipcRenderer.on('acorn:will-quit', listener)
    return () => ipcRenderer.removeListener('acorn:will-quit', listener)
  },
  nodeFetch: (nodeId: string, request: unknown) => ipcRenderer.invoke('acorn:node-fetch', nodeId, request),
  nodeAbort: (requestId: string) => ipcRenderer.send('acorn:node-abort', requestId),
  nodeSend: (nodeId: string, frame: unknown) => ipcRenderer.send('acorn:node-send', nodeId, frame),
  onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => {
    const listener = (_e: unknown, nodeId: string, frame: unknown) => cb(nodeId, frame)
    ipcRenderer.on('acorn:node-frame', listener)
    return () => ipcRenderer.removeListener('acorn:node-frame', listener)
  },
  onNodeStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown) => cb(status)
    ipcRenderer.on('acorn:node-status', listener)
    return () => ipcRenderer.removeListener('acorn:node-status', listener)
  },
  fleetList: () => ipcRenderer.invoke('acorn:fleet-list'),
  // Owner-initiated fleet mutations (client-core/settings/NodesSettings.tsx). Every one of them is a
  // request, never a write: main owns fleet.json and the safeStorage tokens, and no device token or
  // certificate crosses back over this bridge.
  nodeProbe: (endpoint: string) => ipcRenderer.invoke('acorn:node-probe', { endpoint }),
  nodePair: (request: unknown) => ipcRenderer.invoke('acorn:node-pair', request),
  nodeRename: (nodeId: string, label: string) => ipcRenderer.invoke('acorn:node-rename', { nodeId, label }),
  nodeForget: (nodeId: string, revoke: boolean) => ipcRenderer.invoke('acorn:node-forget', { nodeId, revoke }),
  nodeReconnect: (nodeId: string) => ipcRenderer.send('acorn:node-reconnect', nodeId),
  // Settings → Plugins' Restart button. Takes no nodeId: only the LOCAL node is supervised by this app,
  // and a remote node is restarted by whatever started it (nodeBrokerIpc.ts).
  nodeRestartLocal: (): Promise<void> => ipcRenderer.invoke('acorn:node-restart-local'),
  // The preview tunnel. In: a task and a port ON THE NODE. Out: a port on THIS machine. The renderer never
  // sees the node's endpoint or its device token — main owns the pipe (main/previewTunnel.ts).
  nodeTunnelOpen: (request: { nodeId: string; taskId: string; port: number }): Promise<{ port: number }> =>
    ipcRenderer.invoke('acorn:node-tunnel-open', request),
  nodeTunnelClose: (match: { nodeId?: string; taskId?: string }): void =>
    ipcRenderer.send('acorn:node-tunnel-close', match),
  // Third-party plugin bundles (docs/third-party/phase-2-distribution-trust.md). `cachePut` names a
  // node and a plugin and gets back the hash main computed from the bytes it fetched — the bundle
  // itself never crosses this bridge, so the renderer is no more able to touch third-party code than
  // it is to touch a device token.
  plugins: {
    state: () => ipcRenderer.invoke('acorn:plugins-state'),
    cachePut: (request: unknown) => ipcRenderer.invoke('acorn:plugins-cache-put', request),
    trustRecord: (request: unknown) => ipcRenderer.invoke('acorn:plugins-trust-record', request),
  },
  // Node recovery screen (client-core/node/NodeGate.tsx). Only reachable when there is no node to
  // talk to, which is also why `quit` cannot go through the renderer's will-quit prompt: the shell
  // that answers it is not mounted.
  recovery: {
    openDataFolder: () => ipcRenderer.send('acorn:open-data-folder'),
    quit: () => ipcRenderer.send('acorn:force-quit'),
  },
  // The terminal residue: ONLY the native folder picker (dialog.showOpenDialog — a true Electron
  // capability), plus the renderer's desktop-mode marker.
  terminal: {
    folderPath: {
      // Native folder picker (onboarding / project mapping). Returns the chosen absolute path or null.
      pick: () => ipcRenderer.invoke('term:folderPath:pick'),
    },
  },
  // Browser-preview surface (docs/panes.md): a main-owned WebContentsView per task. The
  // renderer drives lifecycle/chrome over IPC and positions the native view over the pane's host rect;
  // main pushes chrome state (loading, url, back/forward) back via onEvent. Agent CDP driving binds
  // inside main when the view is created, so no webContents id ever crosses this bridge.
  preview: {
    ensure: (taskId: string, url: string) => ipcRenderer.invoke('preview:ensure', { taskId, url }),
    setBounds: (taskId: string, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('preview:bounds', { taskId, rect }),
    show: (taskId: string) => ipcRenderer.send('preview:show', { taskId }),
    hide: () => ipcRenderer.send('preview:hide'),
    load: (taskId: string, url: string) => ipcRenderer.send('preview:load', { taskId, url }),
    command: (taskId: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools') => ipcRenderer.send('preview:command', { taskId, action }),
    evict: (taskId: string) => ipcRenderer.send('preview:evict', { taskId }),
    onEvent: (cb: (s: { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => void) => {
      const listener = (_e: unknown, s: { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => cb(s)
      ipcRenderer.on('preview:event', listener)
      return () => ipcRenderer.removeListener('preview:event', listener)
    },
  },
})
