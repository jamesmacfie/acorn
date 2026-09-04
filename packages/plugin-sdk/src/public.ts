// Published declaration, hand-written and copied verbatim to dist/sdk.d.ts. See docs/plugins.md §
// What is published, and what acorn promises about it.

/** What this frame was opened to look at. A snapshot, not reactive: the host recreates a frame when
 * its subject changes, so nothing here updates in place. */
export type PluginFrameContext = {
  /** The contribution id this frame is rendering, as declared in the manifest. */
  surface: string
  /** Which kind of surface this is. It grants nothing (the bridge's allowlist is keyed on the
   * manifest's scopes, never on this field), but a frame may want to lay out differently. `remote` is
   * the tree path rather than a rectangle. */
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview' | 'overlay' | 'coreSlot' | 'remote' | 'inline'
  nodeId: string
  taskId?: string
  projectId?: string
  /** Reference-panel surfaces only: the external item the panel was opened for. */
  refId?: string
  /** The row a declarative rail source was selected on, present only when that selection is what
   * created this frame. Later selections arrive through `onSelect`. */
  item?: string
  /** Overlay surfaces only, and only when a remote tree opened this one as its companion: what the
   * opener handed over, under 64 KiB. An overlay that needs a file gets its id here and fetches the
   * bytes through its own plugin's route. */
  input?: unknown
  theme: string
  style: string
  /** The chords this frame may keep, as the host validated them. `keys.claim` can narrow this set and
   * can never widen it. */
  claimsKeys?: string[]
}

export type PluginWebviewNavigated = { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean }
export type PluginWebviewBlocked = { url: string; host: string }

/** The error a rejected bridge call throws. `code` is the API's own vocabulary, so a plugin branches on
 * the same strings whether the call was denied at the bridge or refused by the node. */
export declare class AcornBridgeError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly requestId: string
  constructor(error: { code: string; message: string; retryable: boolean; requestId: string })
}

/** The whole surface a sandboxed frame has. There is no second door: no `window.acorn`, no network
 * (`connect-src 'none'`), no host DOM. */
export type AcornBridge = {
  /** What this frame was opened to look at. Throws if read before `connect()` resolves. */
  readonly context: PluginFrameContext
  /** Five JSON methods and two byte methods, matching what the host's route table accepts. Your own
   * `/v2/p/<id>/` namespace is always allowed; anything else needs a scope your manifest declared, and
   * another plugin's namespace is always denied, byte call or not. */
  readonly api: {
    get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
    post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
    put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
    patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
    del<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
    /** Read a route of your own whose answer is bytes. The JSON methods above stringify and parse
     * everything, so an image through one costs a third more on the wire and a decode at each end.
     * Capped at 12 MiB. */
    getBytes(path: string, options?: { signal?: AbortSignal }): Promise<PluginByteResponse>
    /** Send bytes to a route of your own. `type` and `filename` are advisory; whatever receives them
     * decides what they really are. */
    postBytes<T>(
      path: string,
      body: { bytes: Uint8Array; type: string; filename?: string },
      options?: { signal?: AbortSignal },
    ): Promise<T>
  }
  events: {
    /** Subscribe to a shell channel the manifest declared. Returns the unsubscribe. Subscribing does
     * not create a channel. */
    on(channel: string, listener: (payload: unknown) => void): () => void
  }
  /** Durable storage, keyed `(pluginId, key)` by the host, capped at 1 MiB per value. The same
   * namespace your node half's `prefs` facet is projected into, and distinct from the frame's own
   * `localStorage`, which is keyed by bundle hash and so rotates with every update. */
  state: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
  }
  ui: {
    toast(title: string, detail?: string): Promise<void>
    /** `navigator.clipboard` refuses to write from a frame, since its document is not the focused
     * one, so this is the only copy that works. */
    copy(text: string): Promise<void>
    /** Open another of this plugin's own panes. */
    openPane(paneId: string): Promise<void>
    /** Hand an `https` URL to the host. Anything else is refused, and resolving says only that the host
     * accepted it: where it lands is the host's business, because the frame does not know which surface
     * it is. */
    openUrl(url: string): Promise<void>
    /** Importer surfaces only: finish, letting the host close the modal and refresh. */
    done(): Promise<void>
    /** Importers and overlays only. A pane does not get to close itself.
     *
     * An overlay a remote tree opened as its companion may pass a JSON `result` under 64 KiB, which
     * resolves that tree's `openOverlay` call. Closing without one resolves it with `null`, and so does
     * every dismissal acorn owns. */
    close(result?: unknown): Promise<void>
  }
  /** The document this frame shares its pane with, when its manifest declared a `document-over-frame`
   * layout. Denied from any other surface, structurally. Nothing about the editor crosses: no cursor,
   * no selection, no decorations. */
  document: {
    read(): Promise<string>
    write(text: string): Promise<void>
    flush(): Promise<void>
  }
  /** Controller only: you cannot read the page or type into it. */
  webview: {
    navigate(url: string): Promise<void>
    back(): Promise<void>
    forward(): Promise<void>
    reload(): Promise<void>
    onNavigated(listener: (state: PluginWebviewNavigated) => void): () => void
    onBlocked(listener: (state: PluginWebviewBlocked) => void): () => void
  }
  keys: {
    /** Replace the active claim set with a subset of this surface's manifest declaration. */
    claim(chords: readonly string[]): void
  }
  /** Fires on every appearance change and once on connect. The tokens are already applied to `:root`
   * by the time it runs; this is for anything you draw yourself that has to be repainted. */
  onAppearance(listener: (appearance: { theme: string; style: string }) => void): () => void
  /** A row was selected on this plugin's rail source while this pane was already open. The selection
   * that opened the pane is `context.item` instead. */
  onSelect(listener: (item: string) => void): () => void
  /** One of this surface's declared commands fired. The host has already flushed the shared document,
   * so reading it back through your own route is safe. */
  onSurfaceAction(listener: (command: string) => void): () => void
}

/** Wait for the host's handshake and resolve the bridge. Resolves once, since a frame has exactly one
 * port for its lifetime, and posts the acknowledgement the host's 10-second deadline is waiting for. */
export declare function connect(): Promise<AcornBridge>

/**
 * Everything between your bundle evaluating and your UI being on screen: inject your stylesheet, make
 * the root element, mount the frame-side tooltip listener, connect, render, and draw the failure if
 * the handshake never lands.
 *
 * It takes a render callback rather than a component so this package stays framework-free. Inside your
 * own frame you may bundle anything.
 *
 * `styles` is your stylesheet as a string, injected rather than linked: a plugin origin serves exactly
 * one file, so a frame with a separate asset is a broken frame.
 */
export declare function mountFrame(options: { styles: string }, render: (bridge: AcornBridge, root: HTMLElement) => void): void

/**
 * Delegated click handler for anchors inside your own rendered content. Returns whether the click was
 * taken.
 *
 * Without it those links do nothing at all: an anchor in a frame cannot navigate (no `allow-popups`,
 * and every subframe is pinned to its own origin), so there is no default to preserve. Modified clicks
 * are taken too, for that reason. A non-`https` href is left alone.
 */
export declare function openLinkOnClick(bridge: AcornBridge, event: MouseEvent): boolean

// ── The tree path ─────────────────────────────────────────────────────────────────────────────────
//
// The second way a bundle draws: a tree of acorn's own components rather than pixels in an iframe.
// Your code names components, acorn mounts them, and what the reader gets has the shell's focus
// behaviour, keyboard handling, ARIA and style pack — none of which an iframe can borrow.
//
// You do not build these nodes by hand unless you want to. `acorn-plugin-sdk/remote` is the Solid
// adapter, and it is fifteen lines because the JSX preset compiles straight onto the functions below.

/** One node in a remote tree. Opaque: build it with the functions below, or with a framework adapter. */
export type RemoteNode = {
  readonly id: string
  readonly type: string
  props: Record<string, unknown>
  parent: RemoteNode | null
  children: RemoteNode[]
}

/** The root acorn handed this mount. Render into `node`. */
export type RemoteRoot = {
  readonly node: RemoteNode
  dispatch(handler: number, payload: unknown): void
  dispose(): void
}

/** What acorn handed one mounted tree, and how to hear about it changing. */
export type TreeMount = {
  /** Which of your renderers acorn asked for, so one bundle can serve several. */
  readonly entry: string
  readonly root: RemoteRoot
  /** The props acorn mounted with. A snapshot; `onProps` carries every later one. */
  props(): unknown
  /** Acorn re-mounted this slot with new props. Register before you render. */
  onProps(listener: (props: unknown) => void): void
  /** Your teardown, run when acorn unmounts this slot. */
  onUnmount(dispose: () => void): void
  /**
   * The two things a tree may ask acorn for, as opposed to describe to it.
   *
   * On the mount rather than on the bridge, because one worker serves every tree your bundle draws and
   * holds one bridge: four attachment previews are four trees and one port, so a request sent over the
   * bridge could not say which of them sent it. These carry the slot as part of their address.
   */
  readonly host: {
    /** Call one action the owning extension point declared and that slot's owner bound. Payload and
     * result are JSON under 64 KiB; eight may be outstanding at once. The owner decides whether to do
     * it, which is why this is a request and not a setter. */
    invoke<TResult = unknown>(action: string, payload?: unknown): Promise<TResult>
    /**
     * Present the one overlay your manifest descriptor associated with this contribution, and wait.
     *
     * Resolves with whatever the overlay passed to `bridge.ui.close(result)`, or `null` for every
     * dismissal. Acorn accepts it only while focus is inside this tree and at most once a second, so
     * call it from a click or key handler. A host with no overlay frames, which is what a terminal is,
     * rejects with `unsupported_host`; draw your static fallback and carry on.
     */
    openOverlay<TResult = unknown>(overlayId: string, input?: unknown): Promise<TResult | null>
  }
}

/** What `api.getBytes` resolves to. `filename` is whatever the route's `Content-Disposition` named, or
 * null when it named nothing. */
export type PluginByteResponse = { bytes: Uint8Array; type: string; filename: string | null }

export type TreeRender = (bridge: AcornBridge, mount: TreeMount) => void

/**
 * Register this bundle's tree renderers and wait for acorn to mount them.
 *
 * Keyed by entry name because one worker serves every tree your bundle contributes, and acorn has to
 * say which. Your manifest's `contributions.extensions[].remote` names a key here; a name with no key
 * behind it draws a labelled placeholder and records a row on your plugin's page. It is not a crash.
 */
export declare function mountTree(renderers: Record<string, TreeRender>): void

/** Create a node named for one of acorn's components. The name is checked when it arrives; an unknown
 *  one draws the placeholder rather than failing the tree around it. */
export declare function createNode(type: string): RemoteNode
export declare function createText(value: string): RemoteNode
/** Set one prop. A function is only sendable under one of acorn's semantic event names (`onPress`,
 *  `onChange`, `onSelect` and the rest); anything else is dropped, and so are `class` and `style`. */
export declare function setProperty(node: RemoteNode, name: string, value: unknown): void
export declare function setText(node: RemoteNode, value: string): void
export declare function insertNode(parent: RemoteNode, node: RemoteNode, anchor?: RemoteNode | null): void
export declare function removeNode(parent: RemoteNode, node: RemoteNode): void
export declare function isTextNode(node: RemoteNode): boolean
export declare function parentOf(node: RemoteNode): RemoteNode | null
export declare function firstChild(node: RemoteNode): RemoteNode | null
export declare function nextSibling(node: RemoteNode): RemoteNode | null
