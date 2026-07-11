import { serve, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import type { Server } from 'node:http'
import type { ApiServerSettingsResponse, PatchApiServerSettingsSchema, PatchedApiServerSettingsSchema } from '../../shared/publicApi/core'
import type { z } from 'zod'
import { PublicApiError } from '../../shared/publicApi/errors'
import { createAutomationApp } from '../../server/publicApi/app'
import type { ApiSettingsController, CoreSystemDeps, RuntimeInfo } from '../../server/publicApi/coreSystem'
import { buildCoreSystemContribution } from '../../server/publicApi/coreSystem'
import { buildCoreResourceContribution } from '../../server/publicApi/coreResources'
import { buildCoreIntegrationsContribution } from '../../server/publicApi/coreIntegrations'
import { buildCoreCommandsContribution } from '../../server/publicApi/coreCommands'
import type { EventPublisher, PluginApiContribution } from '../../server/publicApi/defineEndpoint'
import { IdempotencyStore } from '../../server/publicApi/idempotency'
import { AutomationApiRegistry, type RegistrySnapshot } from '../../server/publicApi/registry'
import { TaskService, type TaskWorktreeHook } from '../../server/publicApi/services/taskService'
import { WorkspaceService } from '../../server/publicApi/services/workspaceService'
import type { TokenService } from '../../server/publicApi/tokenService'
import { EventBus } from './eventBus'
import { attachPublicWsHub, type PublicWsHub } from './wsHub'
import { ApiSettingsStore } from './settingsStore'

// AutomationApiServer (docs/next/api/architecture.md §3.1): the main-owned lifecycle for the public
// loopback listener. It binds exactly 127.0.0.1:<port>, enforces the Host header before Hono, and
// rebinds transactionally when the port changes (start new → persist → stop old).

type PatchInput = z.infer<typeof PatchApiServerSettingsSchema>
type PatchOutput = z.infer<typeof PatchedApiServerSettingsSchema>

export type AutomationServerDeps = {
  settingsStore: ApiSettingsStore
  bindings: Env // runtime bindings merged into the public app's env
  tokens: TokenService
  runtime: Omit<RuntimeInfo, 'shuttingDown'>
  // Plugin contributions to register alongside the core system endpoints, each with its owner id.
  contributions?: { owner: string; contribution: PluginApiContribution }[]
  // Main-process coordination for worktree-bearing task operations. Absent → those ops return
  // capability_unavailable (lazy-worktree creation still works).
  taskWorktreeHook?: TaskWorktreeHook
  publisher?: EventPublisher
  version: string
}

function listen(
  port: number,
  fetch: (req: Request, env: HttpBindings | Http2Bindings) => Response | Promise<Response>,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname: '127.0.0.1', port }, () => {
      server.off('error', reject)
      resolve(server)
    })
    server.once('error', reject)
  })
}

export class AutomationApiServer implements ApiSettingsController {
  private server: ServerType | null = null
  private wsHub: PublicWsHub | null = null
  private snapshot: RegistrySnapshot
  private shuttingDown = false
  private readonly idempotency: IdempotencyStore
  // The in-process event bus; also the EventPublisher endpoint handlers publish through. The public
  // WS hub subscribes to it.
  readonly bus: EventBus

  constructor(private readonly deps: AutomationServerDeps) {
    this.idempotency = new IdempotencyStore(deps.bindings.DB)
    this.bus = new EventBus()
    this.snapshot = this.buildRegistry()
  }

  private buildRegistry(): RegistrySnapshot {
    const registry = new AutomationApiRegistry()
    const coreDeps: CoreSystemDeps = {
      runtime: { ...this.deps.runtime, shuttingDown: () => this.shuttingDown },
      settings: this,
      getSnapshot: () => this.snapshot,
    }
    registry.registerContribution(buildCoreSystemContribution(coreDeps), 'core')
    const db = this.deps.bindings.DB
    registry.registerContribution(
      buildCoreResourceContribution({
        db,
        workspaces: new WorkspaceService(db),
        tasks: new TaskService(db, this.deps.taskWorktreeHook ?? null),
      }),
      'core',
    )
    registry.registerContribution(buildCoreIntegrationsContribution(db, this.deps.bindings.SESSION_ENC_KEY), 'core')
    registry.registerContribution(buildCoreCommandsContribution({ getSnapshot: () => this.snapshot, broker: this.deps.bindings.UI_BROKER }), 'core')
    for (const { owner, contribution } of this.deps.contributions ?? []) {
      registry.registerContribution(contribution, owner)
    }
    return registry.freeze()
  }

  private buildApp(allowedHost: string) {
    return createAutomationApp({
      snapshot: this.snapshot,
      tokens: this.deps.tokens,
      idempotency: this.idempotency,
      allowedHost,
      publisher: this.deps.publisher ?? this.bus,
      version: this.deps.version,
    })
  }

  // Bind a listener on `port` and attach the public WS hub. The Host guard runs before Hono so a
  // DNS-rebinding page cannot reach the API as another origin. Rejects on EADDRINUSE so the caller
  // can surface port_in_use.
  private async bind(port: number): Promise<{ server: ServerType; hub: PublicWsHub }> {
    const allowedHost = `127.0.0.1:${port}`
    const app = this.buildApp(allowedHost)
    const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings): Response | Promise<Response> => {
      const host = request.headers.get('host')
      if (host !== allowedHost) return new Response('Forbidden host', { status: 403 })
      const env: Env = { ...(nodeEnv as HttpBindings), ...this.deps.bindings }
      return app.fetch(request, env)
    }
    const server = await listen(port, fetch)
    const hub = attachPublicWsHub(server as unknown as Server, { tokens: this.deps.tokens, bus: this.bus, allowedHost })
    return { server, hub }
  }

  // Start the listener if settings say enabled. Never throws for "disabled"; a bind failure is
  // surfaced to the caller (bootstrap logs it and keeps the app running).
  async start(): Promise<void> {
    const eff = this.deps.settingsStore.read()
    if (!eff.settings.enabled) return
    const { server, hub } = await this.bind(eff.effectivePort)
    this.server = server
    this.wsHub = hub
    console.log(`acorn automation API on http://${eff.bindAddress}`)
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    await this.closeServer(this.server, this.wsHub)
    this.server = null
    this.wsHub = null
  }

  private closeServer(server: ServerType | null, hub: PublicWsHub | null): Promise<void> {
    hub?.close() // close public sockets before the listener
    if (!server) return Promise.resolve()
    return new Promise((resolve) => (server as unknown as Server).close(() => resolve()))
  }

  read(): ApiServerSettingsResponse {
    const eff = this.deps.settingsStore.read()
    return {
      enabled: eff.settings.enabled,
      port: eff.settings.port,
      effectivePort: eff.effectivePort,
      bindAddress: eff.bindAddress,
      portOverridden: eff.portOverridden,
      ...(eff.error ? { error: eff.error } : {}),
    }
  }

  // Apply an enabled/port change. Port changes rebind transactionally: bind the new listener first,
  // persist only once it is listening, then stop the old one AFTER the current response has flushed
  // (deferred to the next tick).
  async patch(patch: PatchInput): Promise<PatchOutput> {
    const store = this.deps.settingsStore
    if (patch.port !== undefined && store.portOverridden) {
      throw new PublicApiError('setting_overridden', 'The port is pinned by ACORN_API_PORT and cannot be changed until restart')
    }
    const before = store.read()
    const desiredPort = patch.port ?? before.settings.port
    const desiredEnabled = patch.enabled ?? before.settings.enabled
    let rebound = false

    const portChanged = patch.port !== undefined && desiredPort !== before.settings.port && desiredEnabled
    if (portChanged) {
      let next: { server: ServerType; hub: PublicWsHub }
      try {
        next = await this.bind(desiredPort)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('EADDRINUSE')) throw new PublicApiError('port_in_use', `Port ${desiredPort} is already in use`)
        throw new PublicApiError('internal_error', 'Failed to rebind the API listener')
      }
      const old = this.server
      const oldHub = this.wsHub
      this.server = next.server
      this.wsHub = next.hub
      rebound = true
      // close the old listener after the response has flushed (it served this request)
      deferClose(() => this.closeServer(old, oldHub))
    } else if (desiredEnabled && !this.server) {
      const { server, hub } = await this.bind(desiredPort)
      this.server = server
      this.wsHub = hub
    } else if (!desiredEnabled && this.server) {
      const old = this.server
      const oldHub = this.wsHub
      this.server = null
      this.wsHub = null
      deferClose(() => this.closeServer(old, oldHub)) // send the response, then stop
    }

    // Persist only after any bind succeeded.
    store.write({ enabled: desiredEnabled, port: desiredPort })
    this.bus.publish({ channel: 'core.api.settings.updated', data: { enabled: desiredEnabled, port: desiredPort } })
    return { ...this.read(), rebound }
  }

  get snapshotForTest(): RegistrySnapshot {
    return this.snapshot
  }
}

// Defer a listener close until after the in-flight response flushes. setImmediate fires after the
// current I/O callbacks, by which point Hono has written the response body.
function deferClose(close: () => Promise<void>): void {
  setImmediate(() => {
    void close().catch((e) => console.warn('[automation-api] deferred close failed:', e))
  })
}
