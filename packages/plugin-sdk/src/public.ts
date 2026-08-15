// The PUBLISHED declaration, hand-written, copied to `dist/sdk.d.ts` by the build.
//
// Hand-written rather than rolled up, and that is the same call `packages/plugin-api/src/surface.test.ts`
// already made for the same reason: every package in this repository is consumed as TypeScript SOURCE,
// `noEmit` is set globally, and nothing here emits declarations. A real rollup would mean adding a
// declaration build and API Extractor to a monorepo that deliberately has neither — to describe six
// functions.
//
// It is also the better artifact for what this file IS. Everything below is a compatibility promise
// under `PLUGIN_API_MAJOR` (docs/plugins.md § Compatibility), so it should be a thing somebody wrote and
// somebody reviewed, not a thing that fell out of a compiler and grew a name nobody noticed. An emitted
// rollup would also drag `ErrorEnvelope` — and therefore Zod — into the published types for a shape that
// never appears on this surface.
//
// Drift is caught, not trusted: `contract.test.ts` asserts each type below is mutually assignable with
// the real one, so `tsc --noEmit` fails the moment an upstream shape moves underneath a stable name.
// That is the exact gap the surface snapshot cannot see, and it is closed here for the one surface that
// leaves the building.

/** What this frame was opened to look at. A snapshot, not reactive — the host recreates a frame when
 * its subject changes, so nothing here updates in place. */
export type PluginFrameContext = {
  /** The contribution id this frame is rendering, as declared in the manifest. */
  surface: string
  /** Which kind of rectangle this is. It grants nothing — the bridge's allowlist is keyed on the
   * manifest's scopes, never on this field — but a frame may want to lay out differently. */
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview' | 'overlay' | 'coreSlot'
  nodeId: string
  taskId?: string
  projectId?: string
  /** Reference-panel surfaces only: the external item the panel was opened for. */
  refId?: string
  /** The row a declarative rail source was selected on, present only when that selection is what
   * created this frame. Later selections arrive through `onSelect`. */
  item?: string
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
  /** Five methods, matching what the host's route table accepts. Your own `/v2/p/<id>/` namespace is
   * always allowed; anything else needs a scope your manifest declared, and another plugin's namespace
   * is always denied. */
  readonly api: {
    get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
    post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
    put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
    patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
    del<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
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
    /** `navigator.clipboard` refuses to write from a frame — its document is not the focused one — so
     * this is the only copy that works. */
    copy(text: string): Promise<void>
    /** Open another of this plugin's own panes. */
    openPane(paneId: string): Promise<void>
    /** Hand an `https` URL to the host. Anything else is refused, and resolving says only that the host
     * accepted it: where it lands is the host's business, because the frame does not know which surface
     * it is. */
    openUrl(url: string): Promise<void>
    /** Importer surfaces only: finish, letting the host close the modal and refresh. */
    done(): Promise<void>
    /** Importers and overlays only. A pane does not get to close itself. */
    close(): Promise<void>
  }
  /** The document this frame shares its pane with, when its manifest declared a `document-over-frame`
   * layout. Denied from any other surface, structurally. Nothing about the EDITOR crosses — no cursor,
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
   * that OPENED the pane is `context.item` instead. */
  onSelect(listener: (item: string) => void): () => void
  /** One of this surface's declared commands fired. The host has already flushed the shared document,
   * so reading it back through your own route is safe. */
  onSurfaceAction(listener: (command: string) => void): () => void
}

/** Wait for the host's handshake and resolve the bridge. Resolves once — a frame has exactly one port
 * for its lifetime — and posts the acknowledgement the host's 10-second deadline is waiting for. */
export declare function connect(): Promise<AcornBridge>

/**
 * Everything between your bundle evaluating and your UI being on screen: inject your stylesheet, make
 * the root element, mount the frame-side tooltip listener, connect, render — and draw the failure if
 * the handshake never lands.
 *
 * It takes a render CALLBACK rather than a component so this package stays framework-free. Inside your
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
