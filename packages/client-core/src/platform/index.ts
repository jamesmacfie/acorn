import type {
  NodeFetchRequest,
  NodeFetchResponse,
  NodePairRequest,
  NodeProbeResult,
  NodeRecord,
  NodeStatus,
} from '@acorn/protocol/broker.ts'
import type { NodePluginPermissions, PluginExtensionGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'

// The platform seam: the renderer's one door to whatever is hosting it (git history:
// docs/future/node-first/platform-seam.md). See docs/architecture-overview.md § Node API and
// client flow for the seam's shape, its four nullable capability groups, and the arch rule that
// keeps `window.acorn` from spreading past this file.

// ── The capability groups ─────────────────────────────────────────────────────────────────────

// Reaching a node. In Electron, these are IPC calls into main's broker, which holds the device
// token and the socket; the renderer never sees either.
//
// fetch buffers whole responses because that's what can cross IPC (apiClient.ts explains why). A
// web implementation can return a streaming response instead: the type is per-implementation, so
// recording this limitation here doesn't impose it on the next host.
export type NodeTransport = {
  fetch(nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse>
  abort(requestId: string): void
  send(nodeId: string, frame: WsClientFrame): void
  onFrame(cb: (nodeId: string, frame: unknown) => void): () => void
  onStatus(cb: (status: NodeStatus) => void): () => void
}

// Fleet membership, as the renderer performs it: every call is a request to whoever owns
// fleet.json and the encrypted device tokens. `probe` must precede `pair`, since the host pairs
// only against the endpoint whose fingerprint the owner was just shown.
export type FleetBridge = {
  list(): Promise<{ nodes: NodeRecord[]; statuses: NodeStatus[] }>
  probe(endpoint: string): Promise<NodeProbeResult>
  pair(request: NodePairRequest): Promise<NodeRecord>
  rename(nodeId: string, label: string): Promise<NodeRecord | null>
  forget(nodeId: string, revoke: boolean): Promise<void>
  reconnect(nodeId: string): void
  // Only the local node is supervised by the app that hosts this client; a remote node is
  // restarted by whatever started it.
  restartLocal(): Promise<void>
  // Preview tunnel: in, a port on the node; out, a port on this machine.
  tunnelOpen(request: { nodeId: string; taskId: string; port: number }): Promise<{ port: number }>
  tunnelClose(match: { nodeId?: string; taskId?: string }): void
}

// Custody of third-party plugin bundles. See docs/security.md § Third-party plugin bundles for
// why the bytes and cache paths stay with the host and the renderer only ever names a bundle by
// hash.
export type PluginCustody = {
  state(): Promise<PluginHostState>
  cachePut(request: { nodeId: string; pluginId: string; hash: string; version: string }): Promise<PluginPutResult>
  trustRecord(request: PluginTrustDecision): Promise<void>
  // Enter or leave development mode for one plugin on one node. See docs/security.md § The dev
  // grant.
  devGrant(request: PluginDevGrantRequest): Promise<void>
}

// Native actions with no in-page equivalent. Absent everywhere but a desktop shell; every consumer
// hides the affordance rather than offering a button that cannot work.
export type DesktopExtras = {
  // Cmd/Ctrl+W → close the focused pane, never the window. The host suppresses the native accelerator
  // and pings here.
  onClosePane(cb: () => void): () => void
  onWillQuit(cb: () => boolean | Promise<boolean>): () => void
}

// The native folder dialog. Its own group, and not part of `DesktopExtras`, because it is the
// probe the rest of the product used to be gated on by mistake, see `capabilities.ts`.
export type FolderPicker = { pick(): Promise<string | null> }

// The two actions the node recovery screen offers. Neither is expressible in the renderer: one reveals a
// path in the file manager, the other has to bypass the will-quit prompt, whose handler lives in a shell
// that is not mounted behind the gate.
export type RecoveryActions = { openDataFolder(): void; quit(): void }

// Browser-preview surface: a host-owned WebContentsView per task, positioned over the pane's rect.
export type PreviewState = { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
export type PreviewViews = {
  ensure(taskId: string, url: string): Promise<boolean>
  setBounds(taskId: string, rect: { x: number; y: number; width: number; height: number }): void
  show(taskId: string): void
  hide(): void
  load(taskId: string, url: string): void
  command(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools'): void
  evict(taskId: string): void
  onEvent(cb: (state: PreviewState) => void): () => void
}

// Host-owned page surface for an accepted loaded plugin. The sandboxed plugin frame never sees this;
// PluginWebview and its broker are the only callers.
export type PluginWebviewState = { key: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
export type PluginWebviewBlocked = { key: string; url: string; host: string }
export type PluginWebviews = {
  ensure(key: string, url: string, hosts: readonly string[]): Promise<boolean>
  setBounds(key: string, rect: { x: number; y: number; width: number; height: number }): void
  show(key: string): void
  hide(key: string): void
  load(key: string, url: string): Promise<boolean>
  command(key: string, action: 'back' | 'forward' | 'reload'): Promise<boolean>
  evict(key: string): void
  onEvent(cb: (state: PluginWebviewState) => void): () => void
  onBlocked(cb: (state: PluginWebviewBlocked) => void): () => void
}

// What the host holds for third-party plugins: the bundles it has cached, and this device's
// decisions about running them. The storage is Electron's today and a browser's later
// (docs/future/remote.md), so the renderer only ever sees this shape and never a path.
export type PluginTrustDecision = {
  pluginId: string
  hash: string
  nodeId: string
  version: string
  permissions: NodePluginPermissions
  webviews: PluginWebviewGrant[]
  keyClaims: PluginKeyClaimGrant[]
  // What this manifest says about surfaces that are not its own, in both directions
  // (@acorn/protocol/extensionPoints.ts). Required here and defaulted in the store's schema, exactly as
  // `webviews` and `keyClaims` are: an acknowledgement written before the cooperative seam existed reads
  // back as the empty list, which is what was true of it.
  extensions: PluginExtensionGrant[]
  // What this package will run on its own, and how often (docs/schedules.md). Required here and
  // defaulted in the store's schema, exactly as the three above are.
  schedules: PluginScheduleGrant[]
  // What this package will say, and possibly do, when a task is archived. Required here and
  // defaulted in the store's schema, exactly as the four above are.
  taskChecks: PluginTaskCheckGrant[]
  decision: 'accepted' | 'rejected'
}
export type PluginAckRecord = PluginTrustDecision & {
  decidedAt: number
  // The decision was recorded but its disclosure snapshot could not be. See docs/security.md §
  // The dev grant for why such a row never becomes the baseline of a later "what changed" diff.
  partial?: true
}
// Which plugins this device is currently developing, and against which node. See
// docs/security.md § The dev grant for why the key is the pair rather than the plugin id alone.
export type PluginDevGrant = { pluginId: string; nodeId: string; path?: string; grantedAt: number }
export type PluginDevGrantRequest = { pluginId: string; nodeId: string; path?: string; grant: boolean }
export type PluginHostState = {
  cached: Record<string, { pluginId: string; version: string; bytes: number }>
  acks: PluginAckRecord[]
  devGrants: PluginDevGrant[]
}
export type PluginPutResult = { hash: string } | { error: 'unreachable' | 'not-found' | 'too-large' | 'hash-mismatch' }

// ── The Electron implementation ───────────────────────────────────────────────────────────────

// The preload object, shaped as the groups above rather than as a flat bag, so the adapters below are
// projections instead of translations. Everything is optional: an older preload, or none at all.
type AcornPreload = {
  desktop?: boolean
  platform?: string
  onClosePane?: DesktopExtras['onClosePane']
  onWillQuit?: DesktopExtras['onWillQuit']
  nodeFetch?: NodeTransport['fetch']
  nodeAbort?: NodeTransport['abort']
  nodeSend?: NodeTransport['send']
  onNodeFrame?: NodeTransport['onFrame']
  onNodeStatus?: NodeTransport['onStatus']
  fleetList?: FleetBridge['list']
  nodeProbe?: FleetBridge['probe']
  nodePair?: FleetBridge['pair']
  nodeRename?: FleetBridge['rename']
  nodeForget?: FleetBridge['forget']
  nodeReconnect?: FleetBridge['reconnect']
  nodeRestartLocal?: FleetBridge['restartLocal']
  nodeTunnelOpen?: FleetBridge['tunnelOpen']
  nodeTunnelClose?: FleetBridge['tunnelClose']
  plugins?: PluginCustody
  recovery?: RecoveryActions
  folderPath?: FolderPicker
  preview?: PreviewViews
  webview?: PluginWebviews
}

declare global {
  interface Window {
    acorn?: AcornPreload
  }
}

// Guards `window` because there isn't always one: the whole suite runs in a node environment (no
// DOM, no Solid plugin, docs/testing.md), and apiClient consults this on every request rather
// than only inside desktop-only branches. A bare `window.acorn` threw ReferenceError in six tests.
//
// Module-private, so it cannot become the contract by accident the way `window.acorn` almost did
// for `plugins/host.ts`: `tools/arch/boundaries.test.ts` fails any file outside this folder that
// names `window.acorn`.
const acornGlobal = (): AcornPreload | undefined => (typeof window === 'undefined' ? undefined : window.acorn)

// ── The accessors ─────────────────────────────────────────────────────────────────────────────

// "Is a desktop shell hosting this renderer." A marker, nothing more: it must not be used to
// decide whether a feature is available, because almost every feature is HTTP+WS and portable.
export const isDesktopHost = (): boolean => !!acornGlobal()?.desktop

// 'darwin' | 'win32' | 'linux' when a desktop shell is hosting; undefined otherwise.
export const hostPlatform = (): string | undefined => acornGlobal()?.platform

// Null in a plain browser served directly by a node (`dev:node`), where the origin is the node
// and apiClient's same-origin fallback covers it.
//
// One member, `nodeFetch`, is the discriminator for "there is a broker"; the rest degrade
// individually rather than nulling the whole group. That's the same additive-forever tolerance
// docs/api-reference.md § Versioning describes for the wire contract generally.
export const nodeTransport = (): NodeTransport | null => {
  const acorn = acornGlobal()
  if (!acorn?.nodeFetch) return null
  const { nodeFetch } = acorn
  return {
    fetch: nodeFetch,
    abort: (requestId) => acorn.nodeAbort?.(requestId),
    send: (nodeId, frame) => acorn.nodeSend?.(nodeId, frame),
    onFrame: (cb) => acorn.onNodeFrame?.(cb) ?? (() => {}),
    onStatus: (cb) => acorn.onNodeStatus?.(cb) ?? (() => {}),
  }
}

// Null where there is no broker: the origin is the node and there is no membership to read.
//
// Reading the fleet and changing it are different capabilities, `canPairNodes()` below answers the
// second, so the discriminator here is `fleetList` alone. A client that can see the fleet but not
// pair is a coherent host; requiring the pairing machinery in order to read the list is not.
export const fleetBridge = (): FleetBridge | null => {
  const acorn = acornGlobal()
  if (!acorn?.fleetList) return null
  const { fleetList } = acorn
  return {
    list: fleetList,
    probe: (endpoint) => {
      const probe = acorn.nodeProbe
      if (!probe) throw new Error('This build cannot pair nodes.')
      return probe(endpoint)
    },
    pair: (request) => {
      const pair = acorn.nodePair
      if (!pair) throw new Error('This build cannot pair nodes.')
      return pair(request)
    },
    rename: async (nodeId, label) => (await acorn.nodeRename?.(nodeId, label)) ?? null,
    forget: async (nodeId, revoke) => { await acorn.nodeForget?.(nodeId, revoke) },
    reconnect: (nodeId) => acorn.nodeReconnect?.(nodeId),
    restartLocal: async () => {
      const restart = acorn.nodeRestartLocal
      if (!restart) throw new Error('This build does not supervise a local node.')
      await restart()
    },
    tunnelOpen: async (request) => {
      const open = acorn.nodeTunnelOpen
      if (!open) throw new Error('This build cannot tunnel.')
      return open(request)
    },
    tunnelClose: (match) => acorn.nodeTunnelClose?.(match),
  }
}

export const pluginCustody = (): PluginCustody | null => acornGlobal()?.plugins ?? null
export const desktopExtras = (): DesktopExtras | null => {
  const acorn = acornGlobal()
  if (!acorn?.onClosePane || !acorn.onWillQuit) return null
  const { onClosePane, onWillQuit } = acorn
  return { onClosePane, onWillQuit }
}
export const recoveryActions = (): RecoveryActions | null => acornGlobal()?.recovery ?? null
export const previewViews = (): PreviewViews | null => acornGlobal()?.preview ?? null
export const pluginWebviews = (): PluginWebviews | null => acornGlobal()?.webview ?? null

// The native folder dialog, as two calls rather than a nullable object, because both halves are
// used on their own: the probe decides whether to render "Add folder..." at all, and the action is
// fire-and-await. Resolves null when there is no picker or the owner cancelled, so a caller that
// cannot open the dialog and a caller whose dialog was dismissed take the same path.
export const canPickFolder = (): boolean => !!acornGlobal()?.folderPath
export const pickFolder = async (): Promise<string | null> => (await acornGlobal()?.folderPath?.pick()) ?? null

// Whether this host can change fleet membership, as opposed to merely read it (`fleetBridge`).
// Settings → Nodes hides itself rather than offering buttons that cannot work.
export const canPairNodes = (): boolean => !!acornGlobal()?.nodeProbe
