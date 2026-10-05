// Settings → Plugins (docs/plugins/activation.md § Activation). Per node, since which plugins a node runs
// decides which routes exist and which SQLite files open. `running` and `disabled` answer different
// questions: a toggle takes effect at the node's next start, so the page shows the gap between saving
// and restarting.
//
// `state` is the third answer, the only one a restart cannot change: a plugin loaded from disk whose
// init threw is `'failed'`. It stays out of `running` because `restartRequired` is computed from
// `running` alone, and a restart cannot fix a broken plugin (docs/plugins/loaded-plugins.md § Loaded plugins).
export type NodePluginRow = {
  /** The plugin's id. Routes, files, settings keys and the command line all use it. */
  name: string
  /** The name a person reads, such as "GitHub" or "API requests". A loaded plugin's comes from its
   * manifest `name`, and a compiled plugin's from its definition. Display text only: never key
   * anything on it. Optional so a node that predates it still parses, and so the client can fall back
   * to the id (client-core/host/plugins/pluginLabel.ts). A loaded plugin writes its own, so trust
   * prompts keep showing the id. */
  label?: string
  /** Events this running or installed plugin declares for cross-plugin subscribers. */
  emits?: readonly import('../../plugin/contract.ts').PluginEmit[]
  required: boolean
  disabled: boolean
  running: boolean
  // 'pending-restart' means a package sits on the node's disk that this process never loaded: freshly
  // installed, updated, or uninstalled while still running. Like 'failed' it's about the package
  // rather than the toggle, but unlike 'failed' a restart fixes it, so it does raise the banner.
  state: 'active' | 'failed' | 'disabled' | 'pending-restart' | 'pending-review'
  // Epoch millis, present only on a failed row.
  failedAt?: number
  // Why it failed, in the words of whatever broke: the thrown message from a contained init or ready,
  // or the loader's own sentence for a manifest that doesn't parse. Optional, along with `stage`,
  // because the per-node IndexedDB query cache has no version buster and a required field on a
  // persisted response type would need a bumped query key (docs/caching.md).
  //
  // Untrusted display text. It comes from a loaded plugin's own throw, so render it as text, never as
  // markup. The node caps it in node-core/server/pluginHost/state.ts.
  reason?: string
  // Which pass it died in, so the UI can say "failed to load" rather than "failed to start".
  stage?: 'load' | 'init' | 'ready'
  // Present exactly when this plugin came off the node's disk rather than the app binary, which makes
  // it the client's answer to "is this third-party?" (docs/plugins/activation.md).
  installed?: InstalledPluginRow
  /** The declaration committed with the service this process runs. `null` means this node has no
   * active loaded runtime; omission identifies a response cached from a node predating this field. */
  active?: PluginRuntimeIdentity | null
  /** An agent-requested disk candidate held inert until the owner reviews these exact bytes. */
  pendingReview?: { reviewId: string; fingerprint: string; stagedAt: number } | { corrupt: true }
  /** The sources this plugin's derived sources read, and whether the person's grant covers each. Present
   * only for a loaded plugin whose installed version declares inputs. Separate from `state`, because a
   * plugin waiting for this approval still runs (docs/data-sources/derived-sources.md). */
  inputs?: PluginInputs
  /** Present only for a node plugin installed from a local folder, the one kind development mode is
   * for (docs/plugins/dev-loop.md § Development mode for a folder plugin). `on` while the node watches its
   * files, and `reloadedAt` is the last reload that worked since then, in epoch millis. */
  development?: { on: boolean; reloadedAt?: number }
}

/** One line a plugin wrote with `ctx.log` while in development mode. `message` is scrubbed, as it is
 *  on stderr. */
export type PluginLogLine = { at: number; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
/** What `GET /v1/core/plugins/:id/logs` returns: the last 500 lines, oldest first. */
export type PluginLogs = { lines: PluginLogLine[] }

export type PluginInputs = {
  /** A grant exists, so an input it doesn't cover is new or changed in this version. */
  granted: boolean
  inputs: PluginInputLine[]
}

/** One declared input, with the words acorn shows for it. `plural` and `provider` come from the input
 * source's registration and its owner, never from the plugin that reads it. */
export type PluginInputLine = {
  /** The plugin's own source that reads this input. */
  sourceId: string
  name: string
  /** `<pluginId>:<sourceId>` of the source it reads. */
  source: string
  optional: boolean
  /** The plugin's own label for the input. Untrusted display text. */
  label: string
  /** The input source's plural, such as "Pull requests". Absent when no running plugin registers it. */
  plural?: string
  /** Whose account the read uses, such as "GitHub". Absent for a source that needs no account. */
  provider?: string
  approved: boolean
}

export type PluginInputGrant = {
  /** Source id, then input name, exactly as the approved version declared them. */
  sources: Record<string, Record<string, { source: string; optional: boolean }>>
  grantedAt: number
  grantedBy: string
}

/** What `GET /v1/core/plugins/:id/input-grant` returns. `usage` counts published panels per input. */
export type PluginInputGrantState = {
  inputs: PluginInputLine[]
  grant: PluginInputGrant | null
  usage: Record<string, Record<string, { panels: number; connectionIds: string[] }>>
}

export type InstalledPluginRow = {
  version: string
  apiVersion: string
  // What the manifest declared that the node has no meaning for: an unknown top-level key, an unknown
  // contribution kind, an unknown `permissions.node.core` facet. Absent when there is nothing to report.
  //
  // The forward-compatibility rule is that unknown is retained and reported, never dropped silently
  // (docs/plugins/forward-compatibility.md § Forward compatibility). This is the reporting half: the device raises one
  // attention row per entry, on the same path a surface that failed to register takes.
  unknown?: readonly string[]
  permissions: import('../../plugin/contract.ts').NodePluginPermissions
  contributions: import('../../plugin/contract.ts').PluginContributions
  // What the plugin declared other plugins may hear (docs/plugins/events.md § Hearing another plugin). Optional
  // rather than defaulted for the same reason `reason` is: this row is persisted in the query cache
  // and a required field would need a bumped key.
  emits?: readonly import('../../plugin/contract.ts').PluginEmit[]
  // Brand marks the manifest declared: one SVG path's `d` in a 24 box, never an SVG document, plus the
  // brand's own colour as a six-digit hex. The device registers `icon` as `brand:<pluginId>` and each
  // `icons` key as `brand:<pluginId>/<key>`, stamping the prefix from the roster row so a package can't
  // claim another's mark. See client-core/kit/tokens/brandMarks.ts and docs/ui-design/icons.md § Icons.
  icon?: { d: string; color?: string }
  icons?: Record<string, { d: string; color?: string }>
  // The client bundle this node is offering, or null when the package has no client half. `hash` is
  // the sha256 the node computed, and it's a cache-key hint only: the device hashes the bytes it
  // received and refuses a mismatch, because a compromised node can lie here
  // (docs/security/plugin-bundles.md § Third-party plugin bundles).
  client: { hash: string; bytes: number } | null
  // Where the package came from, as one line for the settings row ("github:owner/repo@v1.2.0",
  // "npm:acorn-board", a URL). Absent for a package that predates the installer or was copied in by
  // hand. A display string rather than the structured source, because only the node's lockfile has to
  // re-resolve it.
  source?: string
  // The app seeded this package. It has no lockfile, so the node cannot update it and the settings row
  // offers no update or uninstall. Structured rather than sniffed from `source`, which is display text.
  bundled?: true
  // Epoch millis.
  installedAt?: number
}
/** Manifest-derived fields that must travel together with the running node half and its client bytes.
 * Installation source and timestamps belong only to the disk candidate. */
export type PluginRuntimeIdentity = Omit<InstalledPluginRow, 'source' | 'bundled' | 'installedAt'> & {
  activation: 'node' | 'client-only'
}
// An install the agent asked for and the owner hasn't answered yet (docs/plugins/agent-install.md §
// Approval-mediated install). Raised by the `plugin_request` agent tool, which can't install anything:
// the record is inert until a device reads it and installs over the device-gated route with its own
// principal. A prompt-injected agent can produce this row and nothing else.
export type PluginApprovalRequest = {
  requestId: string
  // The task whose agent asked. The notification pipeline is task-scoped, and this also answers "who
  // asked for this" when the audit row is read back.
  taskId: string
  action: 'install' | 'update' | 'uninstall'
  // Present for an install, exactly as the agent gave it. Nothing has been fetched yet. See
  // docs/plugins/agent-install.md § What the owner can know before the download.
  source?: PluginInstallSource
  // Present for an update or an uninstall.
  pluginId?: string
  // The agent asked for dev mode: on approval the device records a per-(plugin, node) grant that
  // auto-trusts future bundles until the owner ends it (docs/security/plugin-install.md § The dev grant).
  dev: boolean
  purgeData?: boolean
  // Untrusted display text written by an agent that may be reading hostile content. Capped by the
  // tool's input schema. Render it as text, never as markup, and never let it stand in for reading the
  // request.
  reason?: string
  requestedAt: number
}

// `requests` is optional so a node that predates approval-mediated install still parses, and so this
// response type can gain the field without a query-key bump (docs/caching.md).
export type NodePluginState = { plugins: NodePluginRow[]; restartRequired: boolean; requests?: PluginApprovalRequest[] }

// Where a plugin package is fetched from (docs/plugins.md installer). `path` is an absolute directory
// on the node's filesystem, allowed on every build and symlinked rather than copied, so it's the one
// source whose bytes aren't pinned (docs/security/plugin-install.md § Installing from a folder).
export type PluginInstallSource =
  | { github: string; tag?: string }
  | { npm: string; version?: string }
  | { url: string }
  | { path: string }

// Always restart-required: a plugin's routes, tables and jobs are wired at init, so nothing an install
// route does makes the plugin live in the running process.
export type PluginInstallResult = { id: string; version: string; state: 'installed-restart-required' }
export type PluginUpdateResult = { id: string; fromVersion: string; toVersion: string; state: 'installed-restart-required' }
export type PluginUninstallResult = { restartRequired: boolean; dataPurged: boolean }

// The one exception, and only for a plugin the node loaded from disk: a reload swaps its node half in
// the running process (docs/plugins/dev-loop.md § The dev loop). `failed` is a 200, not an error, because
// candidate-then-commit means a failed reload changed nothing and the previous instance still serves.
export type PluginReloadResult = { id: string; version: string; state: 'reloaded' | 'failed'; reason?: string }

export const corePluginsRoute = '/v1/core/plugins'
export const corePluginInstallRoute = '/v1/core/plugins/install'
export const corePluginRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}`
export const corePluginUpdateRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/update`
export const corePluginReloadRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/reload`
export const corePluginReviewRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/review`
// Development mode for a folder-installed node plugin, and the log lines it keeps. Device-only by the same mount.
export const corePluginDevelopmentRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/development`
export const corePluginLogsRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/logs`
// The person's approval of what a loaded plugin's derived sources read. Device-only by the same mount.
export const corePluginInputGrantRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/input-grant`
// The owner's answer to one agent-raised approval request. Device-only, and permanently unmappable
// from a plugin frame: an approval a frame could post would turn the request/decision split back into
// an install route the agent can reach (client-core/host/frames/scopes.ts).
export const corePluginRequestRoute = (requestId: string) => `/v1/core/plugins/requests/${encodeURIComponent(requestId)}`
// The bundle bytes. Device-only like the roster: this is an owner surface, not a task surface, so a
// task-scoped internal token can't reach it (server/index.ts mounts requireDevice over both forms).
export const corePluginBundleRoute = (id: string) => `/v1/core/plugins/${encodeURIComponent(id)}/client.js`
export const corePluginBundleByHashRoute = (id: string, hash: string) =>
  `/v1/core/plugins/${encodeURIComponent(id)}/bundles/${encodeURIComponent(hash)}`
