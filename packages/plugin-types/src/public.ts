// acorn-plugin-types: the node-side plugin API, as declarations only.
//
// What this is for. A loaded plugin is plain JavaScript in a package the owner installed, so until this
// existed the only tier a stranger could write was untyped code against prose. The compiled tier gets
// its types from the repository; this is the same contract for everyone else. Zero dependencies, zero
// runtime, nothing to bundle.
//
// How it stays true. It is hand-written, like `acorn-plugin-sdk`'s `public.ts` and for the same reason:
// nothing in the repository emits declarations, and a compatibility artifact is better as something a
// person wrote and a person reviewed. `contract.test.ts` beside it asserts mutual assignability against
// the implementation, so a shape that moves under a stable name fails there rather than in a stranger's
// build.
//
// What is opaque, and why. Some members carry a type that belongs to a deeper contract: the host's
// drizzle handle, a Zod schema, a wire type from `@acorn/protocol`, a provider-runtime object. Each is
// declared below as a named `HostOwned<'…'>` alias rather than copied, because copying would either drag
// a dependency into a package that promises none, or fork a declaration that has an owner elsewhere.
// The member, its name and its parameters are still pinned; only the far side of the alias is not. A
// plugin that needs one narrows it itself — `ctx.storage.open() as MyDrizzleHandle` — and the contract
// test names every substitution on one line each, so adding an opaque alias is a deliberate act.
//
// The package also ships `acorn-plugin.schema.json`, the JSON Schema for the manifest, generated from
// the same contract. Point your `acorn-plugin.json` at it with `$schema` and the manifest is validated
// in your editor as well.
//
// One assumption, and it is a peer rather than a dependency: `@types/node`. This is a node-side API, so
// `NodeJS.Signals` on a process result names a type every node-side plugin's own project already has.
// Without it, TypeScript reports "Cannot find namespace 'NodeJS'" from inside this file, which is why
// the package declares it as an optional peer instead of leaving it to be discovered. There is nothing
// else, and nothing at all at run time.
//
// See docs/plugins.md § What is published, and what acorn promises about it.

/** A type this package names but does not describe. See the header. `T` is the owning declaration, for
 *  the reader and for the contract test; nothing reads it at runtime because there is no runtime. */
export type HostOwned<T extends string> = { readonly __hostOwned?: T }

// ── Manifest runtime contributions ───────────────────────────────────────────────────────────────

/** The deliberately small JSON Schema language accepted by `contributions.agentTools`. Remote and
 * recursive references, combinators and executable validators are not part of this contract. */
export type PluginToolJsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  description?: string
  properties?: Record<string, PluginToolJsonSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: PluginToolJsonSchema
  enum?: unknown[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export type PluginAgentToolDescriptor = {
  id: string
  description: string
  inputSchema: PluginToolJsonSchema
  risk: 'read' | 'write' | 'execute'
  scope?: 'task'
  handler: string
  requiresSession?: boolean
  timeoutMs?: number
  maxOutputBytes?: number
}

export type PluginContextSectionDescriptor = {
  id: string
  label: string
  scope?: 'task'
  order: number
  read: string
  defaultIncluded?: boolean
  timeoutMs?: number
  maxBytes: number
  maxTokens: number
}

// ── The two entry points ──────────────────────────────────────────────────────────────────────────

/** The default export of a loaded plugin's node entrypoint. `name` must equal the manifest's `id`. */
export type NodePlugin = {
  name: string
  init(ctx: NodePluginContext): void | Promise<void>
  /** A second pass, after every plugin's `init`, for anything that has to read another plugin's
   *  contributions. Use it instead of depending on load order. */
  ready?(ctx: NodePluginContext): void | Promise<void>
  dispose?(): void | Promise<void>
}

/** Everything the host hands a loaded plugin, and nothing it does not.
 *
 * This is the loaded tier's projection. A compiled plugin's context has six more members —
 * `routes.register`, `tools`, `contextSections`, `providers.model`, `events.channel` and
 * `events.streams` — each either a live object that cannot survive a message-passing boundary or a
 * live object that cannot survive the message-passing boundary. Agent tools and context sections
 * have manifest descriptor types above; they deliberately do not become live `ctx` registries.
 *
 * The host's own declaration of this type is
 * `packages/node-core/src/server/pluginHost/types.ts § NodePluginContext`, and a test holds the two
 * equal member for member, so this file cannot quietly fall behind.
 *
 * A facet under `core` is present only if the manifest asked for it. Reaching for one it did not
 * declare is an immediate "not a function", which is the intended failure. */
export type NodePluginContext<Conn = unknown, Items = unknown> = {
  readonly name: string
  routes: PluginRouteRegistry<Conn, Items>
  schedules: PluginScheduleRegistry
  collections: PluginCollectionRegistry
  taskChecks: PluginTaskCheckRegistry
  runs: PluginRunRegistry
  audit: PluginAuditRegistry
  extensionPoints: PluginExtensionPointRegistry
  hooks: PluginHookRegistry
  providers: PluginProviderRegistry
  capabilities: PluginCapabilities
  storage: PluginStorage
  core: CoreServices
  events: PluginBroadcast
  telemetry: PluginTelemetry
  log: Logger
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────

export type PluginRouteOptions = {
  /** Inside this plugin's own namespace: '' owns the whole of it, '/tasks' a sub-resource. The mount
   *  is `/v2/p/<pluginId><prefix>`, and the host strips it before your handler sees the path. */
  prefix?: string
  note?: string
}

/** A `Request` in, a `Response` out. Build the routes with your own bundled router if you like and hand
 *  over its `fetch`; nothing in this signature names a framework. */
export type PluginFetchHandler<Conn = unknown, Items = unknown> = (
  request: Request,
  context: PluginRequestContext<Conn, Items>,
) => Response | Promise<Response>

export type PluginRouteRegistry<Conn = unknown, Items = unknown> = {
  fetch(handler: PluginFetchHandler<Conn, Items>, options?: PluginRouteOptions): void
}

/** What a route handler learns about its caller. The host authenticated the request before this.
 *
 * `Conn` and `Items` are the two shapes this package does not describe: a stored connection row and
 * core's external-item store. Both belong to the integrations contract, and only a plugin that owns an
 * integration provider ever sees them. Leave them alone and they are `unknown`; narrow them by
 * instantiating, `PluginRequestContext<MyConnectionRow>`, if you do own one. */
export type PluginRequestContext<Conn = unknown, Items = unknown> = {
  readonly userId: string
  /** Whether an interactive device, an internal service, or a task-confined credential is calling. */
  readonly principal: Principal
  readonly providers: PluginProviderRuntime<Conn, Items>
}

/** `deviceId` is set only for `'device'`; `scope`, `taskId` and `sessionId` only for `'internal'`.
 *
 * A route that must not be reachable from an agent-spawned child checks `scope`, not `kind`: an agent's
 * credential and the node's own service credential are both `'internal'`. */
export type Principal = {
  kind: 'device' | 'internal'
  /** The node owner's opaque id, and the scope key for every user-scoped table. */
  userId: string
  deviceId?: string
  scope?: 'service' | 'task'
  /** The task an internal credential is bound to. Compare it against the task in your URL. */
  taskId?: string
  sessionId?: string
}

export type RouteFailure = { error: string; status: 401 | 403 | 404 | 429 | 502; detail?: string[] }
export type RouteResult<T> = { ok: true; value: T } | { ok: false; failure: RouteFailure }

export type PluginProviderResourceRequest<TInput> = {
  providerId: string
  connectionId: string
  resourceId: string
  input: TInput
  force?: boolean
}

export type PluginProviderConnectionVisitor<T, Conn = unknown> = (connection: Conn, secret: string) => Promise<T | undefined>

export type PluginProviderRuntime<Conn = unknown, Items = unknown> = {
  resource<TInput, TOutput>(args: PluginProviderResourceRequest<TInput>): Promise<RouteResult<TOutput>>
  connections(providerId: string): Promise<Conn[]>
  /** The host lends one decrypted credential for the length of the callback and no longer. There is no
   *  "read this secret" call, here or anywhere on this surface. */
  withConnections<T>(providerId: string, visit: PluginProviderConnectionVisitor<T, Conn>): Promise<T[]>
  /** This provider's slice of core's external-item cache, for resolution that spans connections. */
  items(providerId: string): Items
}

// ── The registries ────────────────────────────────────────────────────────────────────────────────

/** Periodic work the node runs, whether or not a client is attached (docs/schedules.md). A loaded
 *  plugin normally declares these in its manifest, which is what puts them in front of the owner at
 *  install; the host registers those through this same seam. Any `setInterval` in plugin code is a
 *  review flag. */
export type PluginScheduleRegistry = {
  register(schedule: PluginSchedule): void
}

/** How often a schedule runs. Clamped on read to the plugin floor of 300 seconds, never rejected: a
 *  stored out-of-range value would otherwise be a row the owner can see and the node refuses to load.
 *  `at` is `HH:MM` in the node's local time; `day` is 0 for Sunday. */
export type Cadence =
  | { every: number }
  | { daily: string }
  | { weekly: { day: number; at: string } }

export type PluginSchedule = {
  /** Unique within this plugin. The host prefixes it with your id. */
  scheduleId: string
  name: string
  cadence: Cadence
  /** Seconds, capped at 300. Absent means the engine default of 60. */
  timeout?: number
  enabled?: boolean
  /** Fires on timeout and on node shutdown. Report failure by throwing; the return value is one line of
   *  detail for the run row. */
  run(signal: AbortSignal): Promise<string | void>
}

export type PluginCollectionRegistry = {
  register(collection: HostOwned<'node-core/server/collections/registry.CollectionReadRegistration'>): void
}

/** What this plugin has to say when the owner archives a task, and the cleanup it can offer
 *  (docs/plugins.md § Task checks). */
export type PluginTaskCheckRegistry = {
  register(check: PluginTaskCheck): void
}

export type PluginTaskCheck = {
  /** Unique within the plugin, and stable: it is half of the id the client hands back to say which
   *  cleanups the owner accepted. */
  id: string
  /** `null` when there is nothing to say, which is the common case and has to stay cheap. */
  check(task: TaskRef, signal: AbortSignal): Promise<HostOwned<'protocol/api.TaskConcern'> | null>
  apply?(task: TaskRef, signal: AbortSignal): Promise<void>
}

export type PluginProviderRegistry = {
  integration(
    provider: HostOwned<'node-core/server/integrations/types.IntegrationProviderContribution'>,
    route?: PluginFetchHandler<never, never>,
  ): void
  connection(provider: HostOwned<'node-core/server/integrations/types.ConnectionProviderContribution'>): void
  /** A provider that knows about nodes, and optionally can make and remove them
   *  (docs/plugins.md § Node providers). */
  nodes(provider: HostOwned<'node-core/server/nodeProviders/registry.NodeProviderContribution'>): void
  withConnection<T>(userId: string, providerId: string, visit: PluginProviderConnectionVisitor<T>): Promise<T | undefined>
}

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────

export type Disposable = { dispose(): void }

/** A capability id that carries its own signature, so `get(SOME_ID)` returns the provider's type rather
 *  than `unknown`. `__signature` is never read; it is optional so the brand cannot be built by
 *  accident. */
export type CapabilityId<T> = string & { readonly __signature?: (value: T) => void }

/** One plugin exports a named typed function and another consumes it without importing it
 *  (docs/plugins.md § Collaboration rules). Not a DI container: a map with a phantom-typed key.
 *
 * Resolve at call time, never at init: plugin init order is undefined, so a consumer that caches at
 * init may cache `undefined` for a plugin that was simply declared later.
 *
 * An id you provide must start with `<yourPluginId>.`, the same binding the host applies to your
 * routes, schedules and collections. An id you did not declare in `permissions.node.capabilities`
 * reads as absent, exactly as if the plugin providing it were disabled. */
export type PluginCapabilities = {
  provide<T>(id: CapabilityId<T>, impl: T): Disposable
  get<T>(id: CapabilityId<T>): T | undefined
  /** For a capability whose absence is a bug rather than a configuration. Throws. */
  require<T>(id: CapabilityId<T>): T
  ids(): readonly string[]
}

// ── Runs ──────────────────────────────────────────────────────────────────────────────────────────

/** Where your plugin's runs can be read from the node, for the merged run list core assembles.
 *
 * Register one if your plugin owns work that starts, takes time, and ends — a workflow run, an agent
 * session, a build. You keep your own table, your own lifecycle and your own surfaces; this is a
 * pointer at a `GET` route inside your own namespace that answers `{ runs }`, and the host merges it
 * with every other plugin's without either of you knowing the other exists.
 *
 * The route is called with no client attached and no request in sight, so it takes no params and
 * answers node-wide. Core applies the caller's confinement to the merged answer. Answer with what is
 * happening now rather than your whole history: the list is a "what is running" surface, and a caller
 * that wants one run's detail comes back to your own routes addressing it by id. */
export type PluginRunRegistry = {
  register(source: { runs: string }): void
}

// ── Audit ─────────────────────────────────────────────────────────────────────────────────────────

/** What your plugin puts on the node's audit trail, the owner-readable log in Settings → Security.
 *
 * Declare each verb in your manifest's `contributions.auditActions`; the host replays those
 * declarations through `declare` and qualifies each as `<yourPluginId>:<actionId>`, so you cannot file
 * a row under a core verb or another plugin's. `record` is refused for anything you did not declare —
 * an action nobody can enumerate is one nobody reviews.
 *
 * Record the events a person reviewing this machine would want to see and could not otherwise: work
 * done unattended, money spent, something leaving the node. Not every call your plugin makes; a trail
 * that logs everything buries the entries worth reading.
 *
 * `details` is an allowlisted bag of scalars you choose per action. Never a request body, a credential,
 * or a file's contents: a trail that quotes what it saw becomes a second copy of the thing it protects.
 * Writing is fire-and-forget, like core's own, so a failed insert can never fail the action it
 * describes. */
export type PluginAuditRegistry = {
  declare(action: { id: string; label: string }): void
  record(action: string, entry?: { subject?: string | null; details?: Record<string, string | number | boolean | null> }): void
}

// ── Extension points ──────────────────────────────────────────────────────────────────────────────

/** A point id that carries the type of its entries, the same phantom brand `CapabilityId` uses and for
 *  the same reason. The owning plugin's package exports the constant; you import that and nothing
 *  else. */
export type ExtensionPointId<T> = string & { readonly __entry?: (value: T) => void }

/** One entry in a point. `id` is `<yourPluginId>:<entryId>`, minted by the host, so two plugins can
 *  use the same entry name without shadowing each other. */
export type Extension<T> = {
  id: string
  pluginId: string
  order: number
  value: T
}

/** The node's many-to-many seam, beside the single-provider one above (docs/plugins.md § Cooperative
 *  extension points). Reach for a capability when there is one right answer, and for a point when
 *  there are many: several plugins each adding a workflow step kind, an event sink, a run backend.
 *
 * A point you open must be named `<yourPluginId>:<pointId>`. Contributing to a point nobody has opened
 * is not an error and not a no-op forever: entries wait, and the owner sees them the moment it opens
 * the point, because init order is not a dependency contract. */
export type PluginExtensionPointRegistry = {
  declare<T>(point: ExtensionPointId<T>, label: string): void
  handle<T>(point: ExtensionPointId<T>, entry: { id: string; order?: number; value: T }): void
  /** In declared order, ties broken by id. Resolve at call time, never at init. */
  handlers<T>(point: ExtensionPointId<T>): Extension<T>[]
  /** @deprecated Renamed to `declare`. Removed in the next major of the plugin API. */
  open<T>(point: ExtensionPointId<T>, label: string): void
  /** @deprecated Renamed to `handle`. Removed in the next major of the plugin API. */
  contribute<T>(point: ExtensionPointId<T>, entry: { id: string; order?: number; value: T }): void
  /** @deprecated Renamed to `handlers`. Removed in the next major of the plugin API. */
  entries<T>(point: ExtensionPointId<T>): Extension<T>[]
}

// ── Hooks ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A turn in one of your decisions, offered to other plugins (docs/plugins.md § Hooks).
 *
 * The difference between a hook and an event: an event has already happened and nobody can stop it; a
 * hook runs *before*, in a chain, with a return value. "Task archived" is an event. "Before I push,
 * does anyone object" is a hook.
 *
 * Two halves. `declare` plus `run` is the owner's: say what the moment is and what is allowed at it,
 * then call `run` at the moment and act on the verdict. `handle` is the contributor's, and it names
 * somebody else's point out loud. A loaded plugin normally declares both in its manifest, and the host
 * registers those through this same seam.
 */
export type PluginHookRegistry = {
  /** A point you own. The host qualifies `id` with your plugin id, so you cannot declare a point in
   *  another package's name any more than you can mount a route under one. */
  declare(point: PluginHookPoint): void
  /** A handler on a point, yours or another's. `point` is the qualified `<owner>:<id>`. A handler on a
   *  point nobody has declared, or asking for a mode its owner did not allow, is never called. */
  handle(point: string, handler: PluginHookHandler): void
  /** Run one of your own points. `id` is the bare point id. Never rejects: a handler that throws, times
   *  out or answers with the wrong shape is recorded and skipped, because every hook sits in front of
   *  something you were about to do anyway. */
  run<T extends HookPayload>(id: string, payload: T): Promise<HookVerdict<T>>
}

export type PluginHookPoint = {
  /** Unique within your plugin, and the half of the public name a contributor writes down. */
  id: string
  /** What you are opening, in your words. The trust prompt quotes it. */
  label: string
  /** The declared shape: field name to type, in the same small vocabulary a remote tree's props use.
   *  A transform's answer is checked against it, so a handler cannot turn your payload into something
   *  you never declared. */
  payload: HookPayloadShape
  /** The subset of observe | transform | veto you permit. */
  allows: readonly HookMode[]
  /** Per handler. Five seconds unless you say otherwise. */
  timeoutMs?: number
  /** Veto handlers only, and `allow` unless you say otherwise: a plugin that stalls must not brick
   *  whatever this hook guards. */
  onTimeout?: 'allow' | 'deny'
  /** `priority` reads each handler's own number first, then install time; `install` ignores it. */
  order?: 'priority' | 'install'
  /** Run every veto rather than stopping at the first, so you can show all the reasons at once. */
  collect?: boolean
}

export type PluginHookHandler = {
  /** Unique within your plugin. The host qualifies it before it leaves. */
  id: string
  mode: HookMode
  priority?: number
  /** `{ payload }` for a transform, `{ ok, reason? }` for a veto, anything at all for an observer,
   *  whose answer is dropped unread. */
  run(payload: HookPayload, signal: AbortSignal): Promise<unknown>
}

export type HookMode = 'observe' | 'transform' | 'veto'
export type HookPayloadType = 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]'
export type HookPayloadShape = Record<string, HookPayloadType>
export type HookPayload = Record<string, unknown>

/** What the chain answers. `payload` is the value as the chain left it, transformed or not, so you have
 *  one thing to act on and never have to ask whether anybody changed anything. `by` is the contributing
 *  plugin, stamped by the host and never read off a handler's answer. */
export type HookVerdict<T extends HookPayload = HookPayload> = {
  ok: boolean
  payload: T
  reason?: string
  by?: string
  /** Every reason, when you declared `collect`. */
  reasons?: { reason: string; by: string }[]
}

// ── Storage ───────────────────────────────────────────────────────────────────────────────────────

/** The host owns the filename, the migration run and the close. Call `open()` as often as you like; you
 *  get one handle per boot. */
export type PluginStorage = {
  open(): PluginDatabase
}

/** The handle `open()` returns. Opaque here because it is the host's drizzle handle, and drizzle is the
 *  one framework that crosses the loaded-tier line (docs/plugins.md § What is published). Declare
 *  `drizzle-orm` as your own dependency and narrow it: `ctx.storage.open() as MyHandle`. */
export type PluginDatabase = HostOwned<'node-core/main/pluginStorage.PluginDatabase'>

// ── Broadcasts ────────────────────────────────────────────────────────────────────────────────────

/** Telling connected clients something changed, and hearing that something changed on this node.
 *
 * A broadcast is an invalidation channel, not an event log: no durability, no replay, no delivery
 * guarantee. A client that misses one refetches after the gap. Send "go re-read", not state. */
export type PluginBroadcast = {
  /** Confined to your own `plugin:<yourId>:<verb>` namespace. Anything else throws. */
  send(frame: { channel: string } & Record<string, unknown>): void
  /** "Re-read my chrome descriptors": your rail rows, badges, collections and agent context. Scoped to
   *  your plugin, so it costs nobody else a round trip. */
  status(): void
  /** "Something under this task's worktree changed": a stage, a commit, a discard, a file written. The
   *  dirty markers in the rail and footer come from a `git status` sweep, and this is what tells a
   *  client to take it. `null` when you do not know the task. */
  worktreeStatus(taskId: string | null): void
  /** "This repo's committed config changed and needs the owner's review." */
  repoConfigTrustNotice(taskId: string): void
  /** Raise a row in the owner's notification bell.
   *
   *  `taskId` is optional: leave it off for something that is about the node rather than one task, such
   *  as a connection that expired. Clicking the row opens your plugin's own rail source, or the
   *  Settings page listing your plugin if you contribute no source.
   *
   *  Two fields you can pass are ignored for a plugin loaded from disk. `target` is dropped, because
   *  naming one means naming another plugin's handler and any resource in it. `kind` is dropped, so the
   *  row draws as a plugin row and stays in the bell instead of reaching the desktop. */
  notice(notice: PluginNotice): void
  /** Hear a core event, or another plugin's declared verb, on this node, whether or not a client is
   *  attached. The event must be one your manifest named in `permissions.events`. Another plugin's
   *  `plugin:<id>:<verb>` works when that plugin lists the verb in its manifest's `emits`; if it is not
   *  installed you hear nothing and no error. Disposal follows unload. */
  on(event: NodeEventChannel | `plugin:${string}:${string}`, listener: (frame: { channel: string } & Record<string, unknown>) => void): Disposable
}

/** A bell row you raise with `events.notice`.
 *
 * `target` and `kind` are honoured for a plugin compiled into acorn and dropped for one loaded from
 * disk, which gets its own rail source instead. */
export type PluginNotice = {
  taskId?: string
  title: string
  detail?: string
  kind?: string
  target?: { kind: string; resourceId: string; subresourceId?: string }
}

/** Core events a node half may subscribe to. Each frame's fields are in `@acorn/protocol/nodeEvents.ts`. */
export type NodeEventChannel =
  | 'plugins:changed'
  | 'tasks:changed'
  | 'workspace:changed'
  | 'workspace-projects:changed'
  | 'connection:changed'
  | 'head:changed'
  | 'run:changed'
  | 'agent-session:changed'
  | 'project:changed'
  | 'terminal:sessions-changed'
  | 'worktree:status-changed'

// ── Core services ─────────────────────────────────────────────────────────────────────────────────

/** Path confinement, git, the process broker, use-scoped credentials and the core read models. A
 *  plugin reaches core through this rather than deep-importing anything.
 *
 * Every facet is gated by `permissions.node` in the manifest, and the object you receive holds only the
 * ones you asked for. The type says otherwise on purpose: describing a shape only loaded plugins see
 * would make every facet optional for the compiled plugins that have all of them. */
export type CoreServices = {
  fs: CoreFsService
  git: CoreGitService
  proc: CoreProcService
  secrets: CoreSecretService
  tasks: CoreTaskService
  context: CoreContextService
  models: CoreModelService
  prefs: CorePrefService
  identity: CoreIdentityService
  projects: CoreProjectService
  telemetry: CoreTelemetryService
}

export type CoreFsService = {
  isContainedPath(root: string, candidate: string): boolean
  isValidRepoIdent(value: string): boolean
  /** The absolute path, or `null` when `relPath` is absolute or escapes `root`. */
  resolveInRoot(root: string, relPath: string): string | null
  confineExistingFile(root: string, relPath: string): Promise<ConfineResult>
}

export type ConfineFailure = 'absolute' | 'escapes' | 'missing' | 'not-file'
export type ConfineResult = { ok: true; path: string } | { ok: false; reason: ConfineFailure }

/** The one git seam: `GIT_TERMINAL_PROMPT=0`, `SSH_AUTH_SOCK` passed through, output bounded. */
export type CoreGitService = {
  GIT_MAX_OUTPUT_BYTES: number
  GIT_TIMEOUT_MS: number
  git(args: readonly string[], opts: GitOptions): Promise<ProcResult>
  gitOrThrow(args: readonly string[], opts: GitOptions): Promise<ProcResult>
  gitText(args: readonly string[], opts: GitOptions): Promise<string>
}

export type GitOptions = {
  /** Absolute, and required. An inherited cwd is how a task-scoped command runs against the wrong
   *  checkout. */
  cwd: string
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  env?: Record<string, string>
  stdin?: string
}

/** Every child process: env allowlist, process-group kill, bounded capture. */
export type CoreProcService = {
  DEFAULT_MAX_OUTPUT_BYTES: number
  DEFAULT_TIMEOUT_MS: number
  KILL_GRACE_MS: number
  /** The environment a child will actually see: the allowlisted base, plus this spec's `env` and
   *  `passthrough`. Everything else is absent, including every `ACORN_*` token and every secret. */
  brokerEnv(spec: Pick<ProcSpec, 'env' | 'passthrough'>, parent?: Record<string, string | undefined>): Record<string, string>
  runProcess(spec: ProcSpec): Promise<ProcResult>
  runProcessOrThrow(spec: ProcSpec): Promise<ProcResult>
  ProcessError: HostOwned<'node-core/server/core/exec/proc.ProcessError'>
}

export type ProcSpec = {
  file: string
  args?: readonly string[]
  /** Absolute, and required. See GitOptions.cwd. */
  cwd: string
  /** Merged over the allowlisted base. */
  env?: Record<string, string>
  /** Exact names or `PREFIX_*` globs to carry over from the parent environment as well. For tool
   *  configuration (`DOCKER_HOST`, `GIT_*`), never for credentials. */
  passthrough?: readonly string[]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  stdin?: string
  /** How long a group member gets between SIGTERM and SIGKILL. */
  killGraceMs?: number
}

export type ProcResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** At least one stream hit `maxOutputBytes`. The process was not killed for it. */
  truncated: boolean
  /** Set when the process could not be started at all, such as ENOENT for a missing binary. This is
   *  what lets a caller say "docker is not installed" rather than "docker failed". */
  spawnError: string | null
}

/** Use-scoped credential access. There is no "read this secret" call on this surface, and there will
 *  not be one: the plaintext is scoped to a callback and scrubbed out of anything thrown from it. */
export type CoreSecretService = HostOwned<'node-core/server/core/security/secrets.SecretService'> & {
  use<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T>
  useOptional<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T | null>
  seal(plaintext: string): Promise<string>
}

/** Six fields off the task row. Never the row, and never a database handle. */
export type TaskRef = {
  id: string
  title: string
  projectId: string
  /** `null` runs in the project root; non-null names an isolated worktree branch. */
  branch: string | null
  /** `null` until the worktree is first created. Call `tasks.root(taskId)` rather than reading it. */
  worktreePath: string | null
  pullNumber: number | null
}

export type TaskLinkRef = { provider: string; integrationId: string; identifier: string }
export type ChildTaskSeed = { title: string; branch: string }
export type AttachTaskPullInput = { repoOwner: string; repoName: string; pullNumber: number; sessionId: string; requestId?: string }
export type TaskPullRelation = AttachTaskPullInput & {
  taskId: string
  role: 'primary' | 'related'
  provenance: 'agent'
}

export type CoreTaskService = {
  load(taskId: string): Promise<TaskRef | undefined>
  /** The task's worktree root, creating it lazily. `null` when no checkout is mapped. */
  root(taskId: string): Promise<string | null>
  resolveCwd(
    task: TaskRef | undefined,
    baseCheckout: string | undefined,
  ): Promise<{ cwd: string; isWorktree: boolean; created: boolean }>
  runConfig(taskId: string): Promise<HostOwned<'node-core/server/core/tasks/service.TaskRunConfig'>>
  active(): Promise<TaskRef[]>
  /** Throws when the task or its workspace membership is missing. */
  workspaceId(taskId: string): Promise<string>
  /** The same lookup with "no workspace" as a value. A real database failure still throws. */
  workspaceIdOrNull(taskId: string): Promise<string | null>
  idsForWorkspace(workspaceId: string): Promise<string[]>
  links(taskId: string): Promise<TaskLinkRef[]>
  pulls(taskId: string): Promise<TaskPullRelation[]>
  attachPull(taskId: string, input: AttachTaskPullInput): Promise<TaskPullRelation>
  adoptPullNumbers(repoOwner: string, repoName: string, branchToPull: ReadonlyMap<string, number>): Promise<number>
  /** Ask core to create a task rather than writing core-owned rows. The worktree is not created here. */
  createChild(parentTaskId: string, seed: ChildTaskSeed, intendedChildId?: string): Promise<string>
  cancel(taskId: string): Promise<void>
}

/** Six fields off the project row. Never core config, never a database handle. */
export type ProjectRef = {
  id: string
  name: string
  path: string | null
  workspaceId: string
  github: { owner: string; name: string; repoId: number | null } | null
}

export type ProjectCreateRefInput = {
  name: string
  path?: string | null
  workspaceId?: string
  github?: { owner: string; name: string; repoId?: number | null }
}

export type ProjectUpdateRefInput = {
  path?: string | null
  githubRepoId?: number | null
}

export type CoreProjectService = {
  byId(id: string): Promise<ProjectRef | null>
  byGithub(owner: string, name: string): Promise<ProjectRef | null>
  checkouts(): Promise<{ id: string; path: string }[]>
  /** Every project of one workspace, keeping the ones with no folder on disk. Not granted by
   *  `projects:read` today: no loaded plugin has asked for it. */
  byWorkspace(workspaceId: string): Promise<ProjectRef[]>
  /** Scoped to the provider ids the host registered for your plugin, so another provider's connection
   *  never crosses this boundary. `projectId` is `''` when the link covers the whole workspace. */
  externalProjects(
    workspaceId: string,
    providerIds?: readonly string[],
  ): Promise<Array<{ connectionId: string; externalId: string; projectId: string }>>
  create(input: ProjectCreateRefInput): Promise<ProjectRef>
  update(id: string, patch: ProjectUpdateRefInput): Promise<ProjectRef | null>
  /** The project's build, dev and database scripts: commands acorn executes, behind their own grant. */
  config(id: string): Promise<HostOwned<'protocol/api.ProjectConfigResponse'> | null>
  assertConfigTrusted(taskId: string): Promise<void>
  setup(id: string): Promise<{ script: string | null; trigger: HostOwned<'protocol/api.SetupTrigger'> }>
}

export type CoreContextService = {
  /** The owner's `startup_context_injection` pref. Absent means true. */
  injectionEnabled(userId: string): Promise<boolean>
  assemble(userLogin: string, taskId: string, include: Set<string>): Promise<HostOwned<'protocol/api.TaskContext'> | null>
}

/** Text generation through a stored model-provider connection. You own the prompt; core owns
 *  credential resolution and the provider adapters. */
export type CoreModelService = {
  /** One turn of the backend the request names: a stored API key spent over HTTP, or one run of an
   *  agent CLI installed on this machine with its tools off. The grant does not decide which; the
   *  person who picked from the dropdown does, and your route passes their `backendId` through. */
  generateText(
    request: HostOwned<'node-core/server/core/models.GenerateTextRequest'>,
  ): Promise<HostOwned<'node-core/server/modelProviders/types.GenerateTextResult'>>
  /** Which backends this owner could generate with — a stored API key, or an agent CLI installed on
   *  this machine — as ids and labels only. Connections come first, so a plugin that falls back to
   *  `[0]` keeps spending the key the owner configured. The grant does not decide which backend runs;
   *  the person picking from the dropdown does. */
  available(userId: string): Promise<Array<HostOwned<'protocol/modelProviders.ModelBackend'>>>
}

/** One `(userId, key)` row. A loaded plugin's reads and writes are confined to `plugin:<yourId>:*`,
 *  the same namespace your frames persist into, and values are capped at 1 MiB. */
export type CorePrefService = {
  /** `null` when the owner has never set this key, which is not the same as `''`. */
  read(userId: string, key: string): Promise<string | null>
  write(userId: string, key: string, value: string): Promise<void>
}

export type CoreIdentityService = {
  /** The identity bound to this machine. Read per call rather than cached. */
  active(): string | null
}

/** One attachment on an agent turn, as `agents.draftAttachments` describes it.
 *
 * Written out rather than aliased to `HostOwned`, unlike most of the shapes another plugin's contract
 * owns. The whole point of that capability is that a plugin outside this repository can use it, and an
 * opaque brand would leave such a plugin casting the return value of every call. Six fields of plain
 * data, and no path: where the bytes live is never something a consumer learns. */
export type DraftAttachment = {
  id: string
  taskId: string
  filename: string
  /** What the bytes are, decided by the agents store from magic bytes rather than from what anyone
   *  claimed on the way in. */
  mediaType: string
  byteSize: number
  createdAt: number
}

/** Read one unsent image attachment of a task, and store an altered copy of it
 *  (docs/managed-agents.md § Draft attachments).
 *
 * Two methods, and what is absent is the design. Neither replaces the draft nor deletes the source: the
 * unsent draft is an array in the agent composer's client state, the node cannot transact with it, and
 * deleting a source before the client has committed would lose the reader's only valid attachment. You
 * produce a candidate; the composer commits it when your tree asks, through the `agents:attachment`
 * point's declared `replace` action. */
export type DraftAttachmentsCapability = {
  /** One PNG or JPEG of this task that no turn has claimed, with its content.
   *
   * `null` covers every refusal — another task's, deleted, already sent, never existed — because
   * saying which would answer questions about rows you may not see. */
  read(input: { taskId: string; attachmentId: string }): Promise<{
    attachment: DraftAttachment
    bytes: Uint8Array
  } | null>
  /** Store an altered copy as a new attachment.
   *
   * Always a new row; stored bytes are never edited in place. The source is rechecked immediately
   * before the write, so an attachment sent while your editor was open cannot be replaced after the
   * fact. Magic bytes decide the media type whatever you claimed, the filename is normalized, and the
   * store's own size ceiling holds.
   *
   * Storage is content addressed, so bytes identical to something this task already holds come back as
   * that attachment. Re-applying an edit that changed nothing therefore returns the source itself, and
   * a caller treats that as "no change" rather than as a replacement. */
  createReplacement(input: {
    taskId: string
    sourceAttachmentId: string
    filename: string
    mediaType: 'image/png' | 'image/jpeg'
    bytes: Uint8Array
  }): Promise<DraftAttachment>
}

// ── Telemetry and logging ─────────────────────────────────────────────────────────────────────────

/** What one record can carry beside its name: scalars, and nothing else.
 *
 * An object here would be a place for a request body to hide, and the rule is the audit trail's:
 * a record that quotes what it saw is a second copy of the thing. Keys are dotted and lowercase,
 * at most 64 characters; a string value is cut at 512; a record keeps at most 32 of them. */
export type TelemetryAttrs = Record<string, string | number | boolean | null>

/** A span you opened, for work whose start and end do not fit one closure. `end` is idempotent. */
export type TelemetrySpanHandle = {
  readonly traceId: string
  readonly spanId: string
  end(status?: 'ok' | 'error', attrs?: TelemetryAttrs): void
}

export type TelemetryErrorInput = {
  name: string
  /** Scrubbed by the host: control characters out, the owner's home directory and the data root
   *  collapsed, credential-shaped runs replaced, and capped at 2,000 characters. */
  message?: string
  stack?: string
  level?: 'error' | 'fatal'
  /** `true` when you caught it and carried on, which is the usual case for a plugin. */
  handled?: boolean
  attrs?: TelemetryAttrs
  traceId?: string
  spanId?: string
}

/** Measure your own work (docs/plugin-authoring.md § Telemetry and logging).
 *
 * Every verb is stamped with your plugin id by the host, which is why there is no owner argument
 * and why an `owner` attribute you set is dropped. Every verb is a no-op when the owner has
 * telemetry off, and every verb is wrapped so that a full buffer or a throwing sink cannot reach
 * your code.
 *
 * Nothing here needs a permission. Measuring your own work reads nobody else's; reading the stream
 * is `core.telemetry` and that one is a token. */
export type PluginTelemetry = {
  /** Something happened, with no duration. */
  event(name: string, attrs?: TelemetryAttrs): void
  count(name: string, value?: number, attrs?: TelemetryAttrs): void
  gauge(name: string, value: number, attrs?: TelemetryAttrs): void
  error(error: TelemetryErrorInput): void
  /** Times one call and hands back its own result untouched. Promise-aware, and timed to
   *  settlement rather than to the call that started it. */
  measure<T>(name: string, run: () => T, attrs?: TelemetryAttrs): T
  startSpan(name: string, options?: { attrs?: TelemetryAttrs; traceId?: string; parentSpanId?: string }): TelemetrySpanHandle
}

/** A stderr line prefixed with your plugin id, and a log record with the owner bound when the owner
 *  has telemetry on. Attributes are scalars; an object is refused at the type level. */
export type Logger = {
  debug(message: string, attrs?: TelemetryAttrs): void
  info(message: string, attrs?: TelemetryAttrs): void
  warn(message: string, attrs?: TelemetryAttrs): void
  error(message: string, attrs?: TelemetryAttrs): void
}

/** Read this node's telemetry, behind the `telemetry` token in `permissions.node.core`.
 *
 * A sink sees everything from every owner, which is why it is a token and why the trust prompt
 * draws it high. Return quickly: the collector calls sinks on a timer, awaits none of them and
 * contains a throw, so buffering, retry and sampling are yours. */
export type CoreTelemetryService = {
  /** Node consent, refreshed within five seconds. Check before retrying queued exports. */
  enabled(): boolean
  onBatch(sink: (batch: TelemetryBatch) => void): Disposable
}

/** One flush window's worth of records. `node` and `version` are on the batch rather than on every
 *  record, so a fleet with several nodes reads apart. The record shapes are in
 *  `@acorn/protocol/telemetry.ts`, which a loaded plugin cannot import, so they are opaque here. */
export type TelemetryBatch = {
  node: string
  version: string
  records: readonly HostOwned<'protocol/telemetry.TelemetryRecord'>[]
}

// ── The capability id catalogue ───────────────────────────────────────────────────────────────────

/** Every capability the first-party plugins publish, with its signature.
 *
 * These are declared in `plugins/*​/src/contract/` modules a loaded plugin cannot import,
 * which is why the catalogue is here. Consuming one means naming its id in
 * `permissions.node.capabilities` and resolving it at call time, never at init: plugin init order is
 * undefined, and the providing plugin may be disabled, in which case `get` returns undefined and you
 * degrade around it.
 *
 * A map rather than exported constants, because this package has no runtime: an `import
 * { NOTES_STORE }` that resolved to nothing at run time would be a worse trap than a cast. Write the
 * one line the cast needs and keep it beside your other ids:
 *
 *     const NOTES_STORE = 'notes.store' as CapabilityIdOf<'notes.store'>
 *     const notes = ctx.capabilities.get(NOTES_STORE)
 *
 * The signature is the call acorn promises; each provider's contract module holds the rest. */
export type CapabilityCatalogue = {
  /** Run a prompt in a managed agent session. */
  'agents.sessionExecute': HostOwned<'plugins/agents/contract/sessionExecute.AgentSessionExecute'>
  /** Ask the agent runtime to reconcile after a restart. */
  'agents.runtime': { reconcile(): Promise<void> }
  /** Read durable turn lifecycle state within one task, without prompt or transcript content. */
  'agents.turns': HostOwned<'plugins/agents/contract/lifecycle.AgentTurnsCapability'>
  /** Rebuild one task's agent input-request inbox. */
  'agents.requests': HostOwned<'plugins/agents/contract/lifecycle.AgentRequestsCapability'>
  /** Rebuild one task's active and archived managed-session roster. */
  'agents.sessions': HostOwned<'plugins/agents/contract/lifecycle.AgentSessionsCapability'>
  /** Read one unsent PNG or JPEG turn attachment, and store an altered copy of it. Never a path, never
   *  a sent attachment, and never the draft itself: the composer decides what is in the turn. */
  'agents.draftAttachments': DraftAttachmentsCapability
  /** The host-declared slot whichever plugin owns agent sessions fills. */
  'agents.harnessRegistry': HostOwned<'node-core/server/plugin/harnesses.HarnessRegistry'>
  /** The host-declared hook fired when a task's worktree first exists. */
  'core.taskWorktreeCreated': (taskId: string, worktreePath: string) => void | Promise<void>
  /** Read and steer this node's terminal sessions. */
  'terminal.sessions': HostOwned<'plugins/terminal/contract/sessions.TerminalSessions'>
  /** Push text into a running agent session's PTY. */
  'terminal.sendToAgent': HostOwned<'plugins/terminal/contract/sendToAgent.TerminalSendToAgent'>
  /** Start, stop and inspect a task's run targets. */
  'terminal.runTargets': HostOwned<'plugins/terminal/contract/runTargets.TerminalRunTargets'>
  /** Read and write task, workspace and global notes. */
  'notes.store': HostOwned<'plugins/notes/contract/store.NotesStoreCapability'>
  /** Seed a new task's notes from its linked external items. */
  'notes.seedTask': HostOwned<'plugins/notes/contract/store.SeedTaskNotes'>
  /** The memory index and its launch-context hooks. */
  'memory.knowledge': HostOwned<'plugins/memory/contract/knowledge.MemoryLaunchHooks'>
  /** Read the project or private memory library without exposing file paths or recall bookkeeping. */
  'memory.library': HostOwned<'plugins/memory/contract/library.MemoryLibraryCapability'>
  /** Read ordered metadata for one task's retained browser captures. */
  'browser.captures': HostOwned<'plugins/browser/contract/captures.BrowserCapturesCapability'>
  /** The mirrored GitHub read model for a project. */
  'github.mirror': HostOwned<'plugins/github/contract/mirror.GithubMirrorCapability'>
  /** The page rules that decide what a task's preview pane shows. */
  'preview.rules': HostOwned<'plugins/preview/contract/rules.PreviewRulesCapability'>
  /** Read the node-owned preview home selected from recipe, run target, or project config. */
  'preview.urls': HostOwned<'plugins/preview/contract/urls.PreviewUrlsCapability'>
  /** Ask the workflow runner to reconcile after a restart. */
  'workflows.runner': { reconcile(): Promise<void> }
  /** Rebuild a task's pending workflow approval inbox. */
  'workflows.gates': HostOwned<'plugins/workflows/contract/events.WorkflowGatesCapability'>
  /** The per-step event stream behind the run panel. For a bell row, use `events.notice`, which is
   *  core's and works with workflows disabled. */
  'workflows.notices': {
    stepEvent(runId: string, stepId: string, event: unknown): void
  }
}

export type CapabilityIdOf<K extends keyof CapabilityCatalogue> = CapabilityId<CapabilityCatalogue[K]>
