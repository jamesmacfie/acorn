import type {
  PluginBridgeTelemetryAttrs,
  PluginFrameContext,
  PluginWebviewBlocked,
  PluginWebviewNavigated,
} from '@acorn/protocol/plugin/bridge.ts'

/** A rejected bridge call. `code` matches the API error vocabulary. */
export class AcornBridgeError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly requestId: string
  constructor(error: { code: string; message: string; retryable: boolean; requestId: string }) {
    super(error.message || error.code)
    this.name = 'AcornBridgeError'
    this.code = error.code
    this.retryable = error.retryable
    this.requestId = error.requestId
  }
}

// Five verbs, matching `PluginBridgeApiRequest.method` exactly. `put` was missing until a frame needed
// one: the protocol and the broker both carried PUT from the start and only this facade didn't, so a
// plugin whose routes take a full-replacement body had no way to call them. A method absent here is a
// method no plugin can reach, however permissive the table underneath.
export type AcornBridgeApi = {
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
  put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
  patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
  del<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
  /**
   * Read a route of your own plugin's whose answer is bytes: an image, a PDF, an archive
   * (docs/plugins.md § Binary bridge calls).
   *
   * The five methods above put every request and every response through `JSON.stringify` and
   * `JSON.parse`. Base64 over that would add a third to the wire, two copies in memory, and a decode on
   * each side, for a file the host was already carrying as bytes.
   *
   * The same permission decision as `get`, made at the same point: your own `/v1/p/<your id>/` namespace
   * and nothing else. Capped at 12 MiB either way.
   */
  getBytes(path: string, options?: { signal?: AbortSignal }): Promise<PluginByteResponse>
  /** Send bytes to a route of your own plugin's. `type` and `filename` are advisory: whatever receives
   * them decides what they really are, and a store that keeps files re-sniffs and re-normalizes both. */
  postBytes<T>(
    path: string,
    body: { bytes: Uint8Array; type: string; filename?: string },
    options?: { signal?: AbortSignal },
  ): Promise<T>
}

/** What a telemetry attribute may be: a scalar, and nothing else. An object here would be a place
 *  for a request body to hide, and no sink's column model can index one
 *  (docs/telemetry.md § The attribute vocabulary). */
export type PluginTelemetryAttrs = PluginBridgeTelemetryAttrs

/** What `getBytes` resolves to. `filename` is whatever the route's `Content-Disposition` named, or null
 * when it named nothing; a caller that needs a name owns the fallback. */
export type PluginByteResponse = { bytes: Uint8Array; type: string; filename: string | null }

// Named for what it is rather than for the app: `Acorn` on @acorn/plugin-api/ui is the shell component,
// and two things called Acorn in one plugin's imports is a trap.
export type AcornBridge = {
  /** Per-mount authority, legacy host fallback, or authority-free module bootstrap. */
  readonly treeBridgeMode?: 'mount' | 'legacy' | 'bootstrap'
  /** What this frame was opened to look at. A snapshot, not reactive: a frame is recreated when its
   * subject changes. */
  readonly context: PluginFrameContext
  readonly api: AcornBridgeApi
  events: {
    /** Subscribe to a shell channel the manifest declared. Returns the unsubscribe. */
    on(channel: string, listener: (payload: unknown) => void): () => void
  }
  state: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
  }
  ui: {
    toast(title: string, detail?: string): Promise<void>
    copy(text: string): Promise<void>
    /** Open another of this plugin's own panes. */
    openPane(paneId: string): Promise<void>
    /** Open a manifest-declared cooperative destination owned by another plugin. */
    openDestination(destinationId: string, resourceId: string, subresourceId?: string): Promise<void>
    /**
     * Go to a task on this node. Needs the `core.tasks:read` scope, and works only from a click or
     * key handler, the same as `openUrl`. Rejects when the task is not in the reader's task list.
     */
    openTask(taskId: string): Promise<void>
    /**
     * Hand an `https` URL to the host. It resolves in-app when something recognises it, such as another
     * provider's reference panel or a task pane, and opens the owner's browser otherwise. Anything but
     * `https` is refused. The promise resolving says only that the host accepted the URL: which of those
     * happened isn't the frame's business, because the frame doesn't know which surface it is.
     *
     * Prefer `openLinkOnClick` below for anchors in rendered content; this is the verb underneath it.
     */
    openUrl(url: string): Promise<void>
    /** Importer surfaces only: finish, letting the host close the modal and refresh. */
    done(): Promise<void>
    /**
     * Dismiss the surface: an importer modal without having imported anything, or an overlay once its
     * picker has picked. Refused from any other surface, because a pane doesn't get to close itself.
     *
     * An overlay a remote tree opened as its companion may pass a JSON `result`, which resolves that
     * tree's `openOverlay` call (docs/plugins.md § Companion overlays). Closing without one resolves it
     * with `null`, and so does every dismissal the host owns, so an opener never has to tell
     * "cancelled" from "went away". Capped at 64 KiB: a result names an outcome, and anything with bytes
     * in it goes over the plugin's own route first.
     */
    close(result?: unknown): Promise<void>
  }
  /**
   * The document this frame shares its pane with, when its manifest declared a `document-over-frame`
   * layout. The host draws that editor, including its theme, workers, dirty state and Cmd+S, and these
   * three methods are the entire seam between it and the plugin's own half of the rectangle.
   *
   * Denied from any other surface, structurally: a frame with no document beside it has nothing these
   * could address.
   */
  document: {
    /** The editor's current text, including edits not yet written to the plugin's own route. */
    read(): Promise<string>
    /** Replace it. Goes through the model, so it joins the undo stack and schedules the host's autosave
     * exactly as typing would. */
    write(text: string): Promise<void>
    /** Write anything pending to the plugin's declared write route and wait for it. Rarely needed by
     * hand: the host already flushes before it delivers a surface action. */
    flush(): Promise<void>
  }
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
  /**
   * Say what your frame is doing, in the six verbs the node half's `ctx.telemetry` has
   * (docs/plugin-authoring.md § Telemetry from a frame).
   *
   * Every one is fire and forget: nothing here returns a promise, nothing throws, and nothing tells
   * you whether the owner has collection on. That is the one rule telemetry has, that it never
   * fails the thing it describes. The owner on each record is stamped by the host from this frame's
   * binding, so you cannot file one under another plugin's name and do not pass an id.
   *
   * Each call is one bridge message and counts against the port's budget of 1,000 messages per 10
   * seconds, so emit per action rather than per frame of a render loop.
   */
  telemetry: {
    event(name: string, attrs?: PluginTelemetryAttrs): void
    count(name: string, value?: number, attrs?: PluginTelemetryAttrs): void
    gauge(name: string, value: number, attrs?: PluginTelemetryAttrs): void
    error(error: { name: string; message?: string; attrs?: PluginTelemetryAttrs }): void
    /** Time one call and hand back its own result untouched. Promise-aware, and timed to
     * settlement. The span reaches the host finished, with the duration measured in here. */
    measure<T>(name: string, run: () => T, attrs?: PluginTelemetryAttrs): T
    /** For work whose start and end do not fit one closure. `end` is idempotent. */
    startSpan(name: string, attrs?: PluginTelemetryAttrs): { end(status?: 'ok' | 'error'): void }
  }
  /** A log line with your plugin id already on it, the frame's half of the node's `ctx.log`. It
   * goes to this frame's own console as well, which is the one a plugin author has open. */
  log: {
    debug(message: string, attrs?: PluginTelemetryAttrs): void
    info(message: string, attrs?: PluginTelemetryAttrs): void
    warn(message: string, attrs?: PluginTelemetryAttrs): void
    error(message: string, attrs?: PluginTelemetryAttrs): void
  }
  /** Called on every appearance change, and once on connect. The tokens are already applied to `:root`
   * by the time this fires; the callback is for anything a plugin draws itself, such as a canvas or a
   * chart, that has to be repainted. */
  onAppearance(listener: (appearance: { theme: string; style: string }) => void): () => void
  /** A row was selected on this plugin's declarative rail source while this pane was already open. The
   * selection that opened the pane is `context.item` instead; this fires only for the ones after it. */
  onSelect(listener: (item: string) => void): () => void
  /**
   * One of this surface's declared commands fired: from its chord pressed inside the host's editor, from
   * the palette, or from anywhere else the host runs a command. `command` is the id the manifest
   * declared.
   *
   * Handle it exactly as you would the equivalent button click; the trigger isn't your business. The
   * host has already flushed the shared document, so reading it back through your own route is safe.
   */
  onSurfaceAction(listener: (command: string) => void): () => void
}
