import type { DataSourceInputHandle } from './data.js'

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────

export type PluginRouteOptions = {
  /** Inside this plugin's own namespace: '' owns the whole of it, '/tasks' a sub-resource. The mount
   *  is `/v1/p/<pluginId><prefix>`, and the host strips it before your handler sees the path. */
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
  /** Present only for an operation on a derived source: one handle per input the query bound. */
  readonly inputs?: Readonly<Record<string, DataSourceInputHandle>>
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
  requireFresh?: boolean
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
