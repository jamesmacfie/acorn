import type {
  NodeAdoptRequest,
  NodeFetchRequest,
  NodeFetchResponse,
  NodePairRequest,
  NodeProbeResult,
  NodeRecord,
  NodeStatus,
} from '@acorn/protocol/broker.ts'
import type { NodePluginPermissions, PluginExtensionGrant, PluginHarnessGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '@acorn/protocol/api.ts'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'

// The platform seam: the renderer's one door to whatever is hosting it. See
// docs/architecture-overview.md § Node API and client flow for the seam's shape, its nullable
// capability groups, and the arch rule that keeps `window.acorn` inside this file.

// ── The capability groups ─────────────────────────────────────────────────────────────────────

// Reaching a node. On the desktop these go to the helper's broker, which holds the device token and
// the socket. The renderer never sees either.
//
// `fetch` buffers whole responses because that is what crosses IPC (apiClient.ts explains why). A web
// implementation can stream instead, since the type is per-implementation.
export type NodeTransport = {
  fetch(nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse>
  abort(requestId: string): void
  send(nodeId: string, frame: WsClientFrame): void
  onFrame(cb: (nodeId: string, frame: unknown) => void): () => void
  // The one binary channel: terminal output, as an id-tagged frame the host forwards without reading
  // (@acorn/protocol/ws.ts § The one binary frame). The host peels its own node id; what arrives here
  // still names the session, and wsClient.ts is the one module that reads it.
  onBytes(cb: (nodeId: string, frame: Uint8Array) => void): () => void
  onStatus(cb: (status: NodeStatus) => void): () => void
}

// Fleet membership, as the renderer performs it: every call is a request to whoever owns fleet.json
// and the encrypted device tokens. `probe` must precede `pair`, because the host pairs only against
// the endpoint whose fingerprint the owner was just shown.
export type FleetBridge = {
  list(): Promise<{ nodes: NodeRecord[]; statuses: NodeStatus[] }>
  probe(endpoint: string): Promise<NodeProbeResult>
  pair(request: NodePairRequest): Promise<NodeRecord>
  // The fleet's second door, for a node a plugin's node provider produced
  // (@acorn/protocol/broker.ts § nodeAdoptRequestSchema). No probe step and no fingerprint here on
  // purpose: the host fetches the connection material from the node that listed the record and checks
  // the fingerprint itself, so there is nothing for a caller to confirm or to get wrong.
  adopt(request: NodeAdoptRequest): Promise<NodeRecord>
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

// The native folder dialog. Its own group rather than part of `DesktopExtras`, because gating the
// rest of the product on this probe was the original mistake (`capabilities.ts`).
export type FolderPicker = { pick(): Promise<string | null> }

// Choosing files to attach, and saving one to disk. Unlike the folder dialog these are not
// desktop-only: a page can open its own file input and click its own download link, so the seam
// carries that fallback itself (see `pickFiles` and `saveFile` below) and every caller gets working
// verbs. A host that installs this group takes over with native dialogs, and its save writes where
// the owner chose instead of into the downloads folder.
//
// Bytes cross, never paths. The client and the node are not always the same machine, and the file
// somebody attaches is on theirs, so a path would name something the node cannot open.
export type PickedFile = { name: string; type: string; bytes: Uint8Array }
export type SaveRequest = { bytes: Uint8Array; suggestedName: string; mimeType: string }
export type FileDialogs = {
  // `accept` is bare extensions, no dots, because that is the one spelling every host can honour: a
  // page turns them into the input's `accept`, a shell into dialog filters, a prompt into a hint.
  pick(options: { accept?: readonly string[] }): Promise<PickedFile[]>
  save(request: SaveRequest): Promise<boolean>
}

// Telling somebody something happened while they were not looking, and how many of those are
// waiting. Like the file dialogs and unlike the folder picker, this is not desktop-only: a page has
// `Notification`, so the seam carries that fallback itself (`showNotification` below) and every
// caller gets a working verb. A host that installs this group takes over with the OS's own
// notification centre and can draw a number on the app icon, which a page cannot.
//
// `tag` is the notice id, so an activation can find the notice it came from. `show` answers false
// when nothing was shown — no permission, no notifier — so a caller can tell "the OS said no" from
// "the OS is showing it".
export type NotifyRequest = { title: string; body?: string; tag: string }
export type Notify = {
  show(request: NotifyRequest): Promise<boolean>
  onActivate(cb: (tag: string) => void): () => void
  setBadge(count: number | null): void
}

// The two actions the node recovery screen offers. Neither is expressible in the renderer: one reveals
// a path in the file manager, the other bypasses the will-quit prompt, whose handler lives in a shell
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

// What the host holds for third-party plugins: the bundles it cached, and this device's decisions
// about running them. The renderer sees this shape and never a path, so the storage can move from the
// desktop to a browser (docs/future/remote.md).
export type PluginTrustDecision = {
  pluginId: string
  hash: string
  nodeId: string
  version: string
  permissions: NodePluginPermissions
  webviews: PluginWebviewGrant[]
  keyClaims: PluginKeyClaimGrant[]
  // Each of the five below is required here and defaulted in the store's schema, so an acknowledgement
  // written before the field existed reads back as the empty list, which is what was true of it.

  // What this manifest says about surfaces that are not its own, in both directions
  // (@acorn/protocol/extensionPoints.ts).
  extensions: PluginExtensionGrant[]
  // What this package will run on its own, and how often (docs/schedules.md).
  schedules: PluginScheduleGrant[]
  // What this package will say, and possibly do, when a task is archived.
  taskChecks: PluginTaskCheckGrant[]
  // What this package asks acorn to run as a managed agent (docs/managed-agents.md § Harnesses).
  harnesses: PluginHarnessGrant[]
  decision: 'accepted' | 'rejected'
}
export type PluginAckRecord = PluginTrustDecision & {
  decidedAt: number
  // The decision was recorded but its disclosure snapshot could not be. See docs/security.md §
  // The dev grant for why such a row never becomes the baseline of a later "what changed" diff.
  partial?: true
}
// Which plugins this device is developing, and against which node. See docs/security.md § The dev
// grant for why the key is the pair rather than the plugin id alone.
export type PluginDevGrant = { pluginId: string; nodeId: string; path?: string; grantedAt: number }
export type PluginDevGrantRequest = { pluginId: string; nodeId: string; path?: string; grant: boolean }
export type PluginHostState = {
  cached: Record<string, { pluginId: string; version: string; bytes: number }>
  acks: PluginAckRecord[]
  devGrants: PluginDevGrant[]
}
export type PluginPutResult = { hash: string } | { error: 'unreachable' | 'not-found' | 'too-large' | 'hash-mismatch' }

// ── The desktop implementation ────────────────────────────────────────────────────────────────

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
  onNodeBytes?: NodeTransport['onBytes']
  onNodeStatus?: NodeTransport['onStatus']
  fleetList?: FleetBridge['list']
  nodeProbe?: FleetBridge['probe']
  nodePair?: FleetBridge['pair']
  nodeAdopt?: FleetBridge['adopt']
  nodeRename?: FleetBridge['rename']
  nodeForget?: FleetBridge['forget']
  nodeReconnect?: FleetBridge['reconnect']
  nodeRestartLocal?: FleetBridge['restartLocal']
  nodeTunnelOpen?: FleetBridge['tunnelOpen']
  nodeTunnelClose?: FleetBridge['tunnelClose']
  plugins?: PluginCustody
  recovery?: RecoveryActions
  folderPath?: FolderPicker
  files?: FileDialogs
  notify?: Notify
  preview?: PreviewViews
  webview?: PluginWebviews
}

declare global {
  interface Window {
    acorn?: AcornPreload
  }
}

// Guards `window` because there is not always one. The suite runs in a node environment
// (docs/testing.md) and apiClient consults this on every request, so a bare `window.acorn` throws
// ReferenceError.
//
// Module-private, so it cannot become the contract by accident. `tools/arch/boundaries.test.ts` fails
// any file outside this folder that names `window.acorn`.
const acornGlobal = (): AcornPreload | undefined => (typeof window === 'undefined' ? undefined : window.acorn)

// ── The accessors ─────────────────────────────────────────────────────────────────────────────

// Whether a desktop shell hosts this renderer. A marker only. Do not gate a feature on it, because
// almost every feature is HTTP plus WS and portable.
export const isDesktopHost = (): boolean => !!acornGlobal()?.desktop

// 'darwin' | 'win32' | 'linux' when a desktop shell is hosting; undefined otherwise.
export const hostPlatform = (): string | undefined => acornGlobal()?.platform

// Null in a plain browser served by a node (`dev:node`), where apiClient's same-origin fallback
// covers it.
//
// `nodeFetch` alone discriminates "there is a broker". The rest degrade individually rather than
// nulling the whole group, the same tolerance docs/api-reference.md § Versioning describes.
export const nodeTransport = (): NodeTransport | null => {
  const acorn = acornGlobal()
  if (!acorn?.nodeFetch) return null
  const { nodeFetch } = acorn
  return {
    fetch: nodeFetch,
    abort: (requestId) => acorn.nodeAbort?.(requestId),
    send: (nodeId, frame) => acorn.nodeSend?.(nodeId, frame),
    onFrame: (cb) => acorn.onNodeFrame?.(cb) ?? (() => {}),
    onBytes: (cb) => acorn.onNodeBytes?.(cb) ?? (() => {}),
    onStatus: (cb) => acorn.onNodeStatus?.(cb) ?? (() => {}),
  }
}

// Null where there is no broker: the origin is the node and there is no membership to read.
//
// Reading the fleet and changing it are different capabilities, and `canPairNodes()` answers the
// second, so `fleetList` alone discriminates here. A host that reads the fleet without pairing is
// coherent.
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
    adopt: (request) => {
      const adopt = acorn.nodeAdopt
      if (!adopt) throw new Error('This build cannot adopt provided nodes.')
      return adopt(request)
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

// The native folder dialog, as two calls rather than a nullable object, because the probe decides
// whether to render "Add folder..." at all. Resolves null when there is no picker and when the owner
// cancelled, so both take the same path.
export const canPickFolder = (): boolean => !!acornGlobal()?.folderPath
export const pickFolder = async (): Promise<string | null> => (await acornGlobal()?.folderPath?.pick()) ?? null

// The host's native file dialogs, or null where the page does its own (below). Consumers call
// `pickFiles` and `saveFile`; this accessor exists for the seam contract, which checks the group the
// host installed rather than the fallback.
export const fileDialogs = (): FileDialogs | null => acornGlobal()?.files ?? null

// Empty when nobody chose anything and when there was nowhere to ask, so both take the same path.
export const pickFiles = async (options: { accept?: readonly string[] } = {}): Promise<PickedFile[]> => {
  const host = acornGlobal()?.files
  if (host) return host.pick(options)
  if (typeof document === 'undefined') return []
  return await new Promise<PickedFile[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (options.accept?.length) input.accept = options.accept.map((extension) => `.${extension}`).join(',')
    // On a browser without `cancel` the promise never settles and the element is collected, which is
    // the same outcome as the owner walking away from the dialog.
    input.oncancel = () => resolve([])
    input.onchange = () => {
      void Promise.all([...(input.files ?? [])].map(async (file) => ({
        name: file.name,
        type: file.type || 'application/octet-stream',
        bytes: new Uint8Array(await file.arrayBuffer()),
      }))).then(resolve)
    }
    input.click()
  })
}

// False when the save was declined and when there was nowhere to save to. The renderer never learns
// the path: a shell that saves owns the filesystem touch, exactly as the folder dialog does.
export const saveFile = async (request: SaveRequest): Promise<boolean> => {
  const host = acornGlobal()?.files
  if (host) return host.save(request)
  if (typeof document === 'undefined') return false
  const url = URL.createObjectURL(new Blob([request.bytes as unknown as BlobPart], { type: request.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = request.suggestedName
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}

// The host's notification group, or null where the page does its own (below). Consumers call
// `showNotification`, `onNoticeActivated` and `setBadge`; this accessor exists for the seam contract,
// which checks the group the host installed rather than the fallback.
export const notifyHost = (): Notify | null => acornGlobal()?.notify ?? null

// The page's own notifications, held until they close. A `Notification` whose only reference is the
// browser's can be collected with its click handler still unfired, which is the bug orca hit.
const shownNotifications = new Map<string, Notification>()
// Subscribers to the fallback's clicks. A host that installs the group answers `onNoticeActivated`
// itself, so this set stays empty there.
const activationListeners = new Set<(tag: string) => void>()

/** Raise one, through the host if it installed the group and through the page otherwise. False means
 *  nothing was shown: permission refused, or no notifier at all. Silent in both, always: the chime is
 *  the client's (features/notifications/chime.ts) and it plays whether or not a banner appeared. */
export const showNotification = async (request: NotifyRequest): Promise<boolean> => {
  const host = acornGlobal()?.notify
  if (host) return host.show(request)
  const Ctor = (globalThis as { Notification?: typeof Notification }).Notification
  if (!Ctor) return false
  const permission = Ctor.permission === 'default' ? await Ctor.requestPermission() : Ctor.permission
  if (permission !== 'granted') return false
  const notification = new Ctor(request.title, { body: request.body, tag: request.tag, silent: true })
  shownNotifications.set(request.tag, notification)
  notification.onclose = () => shownNotifications.delete(request.tag)
  notification.onclick = () => {
    window.focus()
    for (const cb of activationListeners) cb(request.tag)
    notification.close()
  }
  return true
}

/** Somebody clicked one. The tag is the notice id it was raised for. */
export const onNoticeActivated = (cb: (tag: string) => void): (() => void) => {
  const host = acornGlobal()?.notify
  if (host) return host.onActivate(cb)
  activationListeners.add(cb)
  return () => activationListeners.delete(cb)
}

// Whether this host can draw a number on the app icon. A page cannot, and the settings row hides
// rather than offering a switch that does nothing.
export const canSetBadge = (): boolean => !!acornGlobal()?.notify

/** The number on the app icon, or null for none. A no-op where there is no icon to draw on. */
export const setBadge = (count: number | null): void => acornGlobal()?.notify?.setBadge(count)

// Whether this host can change fleet membership rather than only read it (`fleetBridge`). Settings →
// Nodes hides itself rather than offering buttons that cannot work.
export const canPairNodes = (): boolean => !!acornGlobal()?.nodeProbe
