import type {
  NodeFetchRequest,
  NodeFetchResponse,
  NodePairRequest,
  NodeProbeResult,
  NodeRecord,
  NodeStatus,
} from '@acorn/protocol/broker.ts'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'

// What the hosting environment provides (docs/features.md, docs/electron.md §capability-map). The
// preload carries the node broker plus a thin native residue (folder picker, preview view controls,
// lifecycle callbacks). The data surface is one WebSocket and ordinary /v2 routes, so most panes need
// nothing Electron-specific — but the node serves no web assets, so `dev:node` is no longer a way to
// open the UI in a browser; it is an API-only node. `desktop` still marks the Electron build; `terminal` marks that the main-process engine is
// present — the surfaces that genuinely need it (terminal drawer, agents, run targets, workflows,
// the PTY streams) key off it and degrade with a visible reason where it's absent. Consumers that
// *invoke* the bridge use the typed accessors (terminalApi() etc.); this answers "is it available?".
export type Capabilities = {
  desktop: boolean // preload bridge present (Electron renderer)
  terminal: boolean // main-process terminal/worktree engine available (drawer, agents, run targets, workflows, PTY streams)
}

export type ClientCapabilityRequirement = 'none' | keyof Capabilities

// The residual preload bridge. Everything request/response is loopback HTTP and every stream is the
// WebSocket (wsClient.ts); what survives here are the things that genuinely cannot be either — the
// native folder picker (dialog.showOpenDialog) and the main-owned preview WebContentsView.
//
// `terminal` is also the desktop-mode probe: the typed accessors built on it (taskBridge(),
// terminalApi()) return null when it is absent, which is what every `if (!api)` guard keys off. The
// global is declared HERE, in core, because core's own capability map reads it — declaring it in a
// feature would mean core's contract was typed by a plugin. One declaration site only.
export type TerminalStreamBridge = {
  folderPath: { pick(): Promise<string | null> }
}

// Re-exported so consumers of the bridge get the wire types without importing protocol themselves.
export type {
  NodeFetchRequest,
  NodeFetchResponse,
  NodePairRequest,
  NodeProbeResult,
  NodeRecord,
  NodeStatus,
} from '@acorn/protocol/broker.ts'

// Chrome state pushed from main for the active preview view (PreviewPane consumes it).
export type PreviewState = { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

// What main holds for third-party plugins: the bundles it has cached, and this device's decisions
// about running them. Mirrors apps/desktop/src/app/main/pluginIpc.ts; the storage behind it is
// Electron's today and a browser's later (docs/future/remote.md), which is why the renderer only ever
// sees this shape and never a path.
export type PluginTrustDecision = {
  pluginId: string
  hash: string
  nodeId: string
  version: string
  permissions: NodePluginPermissions
  decision: 'accepted' | 'rejected'
}
export type PluginAckRecord = PluginTrustDecision & { decidedAt: number }
export type PluginHostState = {
  cached: Record<string, { pluginId: string; version: string; bytes: number }>
  acks: PluginAckRecord[]
}
export type PluginPutResult = { hash: string } | { error: 'unreachable' | 'not-found' | 'too-large' | 'hash-mismatch' }

declare global {
  interface Window {
    acorn?: {
      desktop?: boolean
      platform?: string
      // Cmd/Ctrl+W → close the focused pane. Returns an unsubscribe.
      onClosePane?: (cb: () => void) => () => void
      // App quit lifecycle concern collection. Returns an unsubscribe.
      onWillQuit?: (cb: () => boolean | Promise<boolean>) => () => void
      // Node access via the connection broker in Electron main. The renderer holds no device token and
      // opens no socket of its own: these primitives are what apiClient.ts and wsClient.ts are built on,
      // rather than a live socket object crossing contextBridge as a closure.
      nodeFetch?: (nodeId: string, request: NodeFetchRequest) => Promise<NodeFetchResponse>
      nodeAbort?: (requestId: string) => void
      nodeSend?: (nodeId: string, frame: WsClientFrame) => void
      onNodeFrame?: (cb: (nodeId: string, frame: unknown) => void) => () => void
      onNodeStatus?: (cb: (status: NodeStatus) => void) => () => void
      fleetList?: () => Promise<{ nodes: NodeRecord[]; statuses: NodeStatus[] }>
      // Fleet membership mutations. All of them are requests to main, which owns fleet.json and the
      // safeStorage-encrypted device tokens; `nodeProbe` must precede `nodePair`, because main only
      // pairs against the endpoint whose fingerprint the owner has just been shown (Settings → Nodes).
      nodeProbe?: (endpoint: string) => Promise<NodeProbeResult>
      nodePair?: (request: NodePairRequest) => Promise<NodeRecord>
      nodeRename?: (nodeId: string, label: string) => Promise<NodeRecord | null>
      nodeForget?: (nodeId: string, revoke: boolean) => Promise<void>
      nodeReconnect?: (nodeId: string) => void
      nodeRestartLocal?: () => Promise<void>
      nodeTunnelOpen?: (request: { nodeId: string; taskId: string; port: number }) => Promise<{ port: number }>
      nodeTunnelClose?: (match: { nodeId?: string; taskId?: string }) => void
      // Third-party plugin bundles (docs/third-party/phase-2-distribution-trust.md). Reached only
      // through plugins/host.ts, which is the client's platform adapter for them: bundle bytes and
      // cache paths stay in main, so the renderer names a bundle by the hash main computed and by
      // nothing else. `cachePut` asks main to fetch a plugin's client half from a node.
      plugins?: {
        state(): Promise<PluginHostState>
        cachePut(request: { nodeId: string; pluginId: string; hash: string; version: string }): Promise<PluginPutResult>
        trustRecord(request: PluginTrustDecision): Promise<void>
      }
      // The two native actions the node recovery screen offers (node/NodeGate.tsx). Neither is
      // expressible in the renderer: one reveals a path in Finder, the other has to bypass the
      // will-quit prompt, whose handler lives in a shell that is not mounted behind the gate.
      recovery?: {
        openDataFolder(): void
        quit(): void
      }
      terminal?: TerminalStreamBridge
      // Browser-preview surface: drive the task's main-owned WebContentsView.
      preview?: {
        ensure(taskId: string, url: string): Promise<boolean>
        setBounds(taskId: string, rect: { x: number; y: number; width: number; height: number }): void
        show(taskId: string): void
        hide(): void
        load(taskId: string, url: string): void
        command(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools'): void
        evict(taskId: string): void
        onEvent(cb: (s: PreviewState) => void): () => void
      }
    }
  }
}

export const capabilities = (): Capabilities => ({
  desktop: !!acornGlobal()?.desktop,
  terminal: !!acornGlobal()?.terminal,
})

export const hasClientCapability = (requirement: ClientCapabilityRequirement = 'none'): boolean =>
  requirement === 'none' || capabilities()[requirement]

// Typed accessor for the injected preload global.
//
// `declare global { interface Window }` above only applies to programs that include THIS file. A
// consumer compiling a module that merely says `window.acorn` — taskBridge.ts did — sees a bare
// Window and fails once it is compiled from another package. Reaching for the global through this
// function makes the augmentation travel with the import graph.
// Guards `window` because there isn't always one: the whole suite runs in a node environment (no DOM,
// no Solid plugin — see docs/testing.md), and apiClient now consults this on every request rather than
// only inside desktop-only branches. A bare `window.acorn` here threw ReferenceError in six tests.
export const acornGlobal = (): Window['acorn'] => (typeof window === 'undefined' ? undefined : window.acorn)
