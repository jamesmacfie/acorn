// Test-only helper. See testkit/db.ts for why this directory exists, and docs/plugins.md § What is
// published, and what acorn promises about it, for why this calls the real host code path instead
// of forging a context.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import type { PluginFrameSurface } from '@acorn/protocol/plugin/contract.ts'
import type { Env } from '../server/bindings'
import { memoryIdentityStore } from '../server/activeIdentity'
import { createCoreServices, SecretService, type CoreServices } from '../server/core'
import type { NodePermissions } from '../server/plugins/manifest'
import { openPluginDb, type PluginDatabase } from '../server/plugins/storage'
import type { AppDatabase } from '../server/db'
import type { AppEnv, Principal } from '../server/middleware/auth'
import { CapabilityRegistry } from '../server/pluginHost/capabilities'
import { buildPluginContext } from '../server/pluginHost/context'
import { clearRegistrations } from '../server/pluginHost/host'
import { flushTelemetry, onTelemetryBatch, setTelemetryPref } from '../server/telemetry/collector'
import { pluginRequestContext } from '../server/pluginHost/requestContext'
import type { CompiledNodePluginContext, NodePlugin, PluginProviderRuntime, PluginRequestContext, PluginStorage } from '../server/pluginHost/types'
import { makeTestDb, testEnv, TEST_ENCRYPTION_KEY, workspacePluginMigrations } from './db'

// Nothing granted. A loaded plugin's manifest block is all-defaulted (protocol/plugin/contract.ts), so
// this is what `permissions: {}` means in a config, and a test opts into each grant by name.
const NO_PERMISSIONS: NodePermissions = { core: [], capabilities: [], secrets: false, exec: false, net: [] }

export type TestNodeContextOptions = {
  // The plugin under test. A NodePlugin satisfies this, so `{ plugin: rollbarPlugin() }` reads well.
  // Only the name is used, because every owner-bound registration binds from it.
  //
  // init() is not called here. Running it is the test's job: the init/ready/containment lifecycle
  // belongs to initPlugins, and a test usually wants to assert on what init did, or on it throwing.
  plugin: Pick<NodePlugin, 'name'>
  // Pass this to get the loaded tier: scoped core and capabilities, no routes.register and no
  // events.channel/streams (docs/plugins.md § What is published, and what acorn promises about it).
  // Omit for the built-in tier, the full context exactly as the host builds it. `ctx.storage` is
  // present in both tiers.
  permissions?: Partial<NodePermissions>
  /** Manifest-declared cooperative destinations for loaded-tier notice tests. */
  destinations?: readonly NonNullable<PluginFrameSurface['destinations']>[number][]
  // Where ctx.storage.open() migrates from. Defaults to this checkout's `plugins/<id>/migrations`, which
  // suits every workspace plugin's suite. Pass it for a chain that lives somewhere else.
  migrations?: string
  dataDir?: string
  // Who this node is bound to, for `ctx.core.identity.active()`. Null by default, because a context
  // built with nothing seeded has had no boot to mint one. Pass it where the plugin reads the owner
  // off `ctx` rather than off a request: an agent tool, a workflow step, a telemetry sink.
  userId?: string
}

// The context, plus the handles a test needs to set the world up around it. Flat rather than
// `{ ctx, db, ... }` so `ctx.storage.open()` and `ctx.db` read the same way. If the context grows
// a member named `db`, `env`, `recorded` or `cleanup`, this intersection stops compiling and one of
// the two names has to move.
export type TestNodeContext = CompiledNodePluginContext & {
  // Core's tables, migrated, in a temp directory. For seeding the workspaces/tasks/integrations rows a
  // route or a service reads back.
  db: AppDatabase
  // Bindings for a route test, already carrying DB and the secret service. `testEnv({ ...ctx.env, X })`
  // to add what a particular route reads.
  env: Env
  dataDir: string
  encryptionKey: string
  // Every record this node built since the context was made, newest last: what `ctx.telemetry` and
  // `ctx.log` produced, and what the host produced on this plugin's behalf. Read `attrs.owner` to
  // tell those apart, because a sink sees every owner and this is one.
  //
  // Reading it flushes first, so an assertion runs against what the emit verb just did rather than
  // against whatever the five-second timer last handed over.
  readonly recorded: readonly TelemetryRecord[]
  // Undoes everything the plugin registered, through the host's own rollback. Then closes core's
  // database, the plugin's if it was opened, and removes the temp directories. Call it in a finally or
  // an afterEach: the route, tool and provider registries are process-wide module singletons, so a
  // registration left behind becomes the next test file's duplicate.
  cleanup(): void
}

export function makeTestNodeContext(options: TestNodeContextOptions): TestNodeContext {
  const name = options.plugin.name
  const core = makeTestDb()
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), `acorn-testkit-${name}-`))
  const permissions = options.permissions ? { ...NO_PERMISSIONS, ...options.permissions } : undefined
  const secrets = new SecretService(TEST_ENCRYPTION_KEY)
  const services: CoreServices = createCoreServices({ secrets, db: core.db, activeIdentity: memoryIdentityStore(options.userId ?? null) })

  // The same lazy, one-handle-per-boot shape the host builds for both tiers (server/pluginHost/host.ts): one
  // file named for the plugin id under the data root, migrated with the plugin's own chain on first open.
  let opened: PluginDatabase | null = null
  const storage: PluginStorage = {
    open: () => {
      const migrations = options.migrations ?? workspacePluginMigrations(name)
      if (!migrations) {
        throw new Error(`makeTestNodeContext({ plugin: '${name}' }) found no chain at plugins/${name}/migrations, so ctx.storage.open() has nothing to run. Pass { migrations }.`)
      }
      opened ??= openPluginDb(dataDir, name, { migrationsFolder: migrations })
      return opened
    },
  }

  // What `clearRegistrations` cannot reach: the WS hub's two slots, which are module singletons with
  // no duplicate guard, and any schedule the plugin declared, which lives in a scheduler the host owns
  // (server/pluginHost/context.ts). Without this, a test whose plugin claims a channel prefix or registers
  // a schedule leaves it claimed for the whole file.
  const undos: (() => void)[] = []

  // The recorder, which is a sink like any other: nothing in the collector is test-specific
  // (../server/telemetry/collector.ts, docs/plugin-authoring.md § In tests). The preference is
  // stated rather than read, because a test has no `telemetry.enabled` row and building nothing is
  // not what a test asking about telemetry wants. It stays on for the process, which costs a
  // record per emit and is the same bargain `startTelemetry` makes.
  const records: TelemetryRecord[] = []
  setTelemetryPref(true)
  const recorder = onTelemetryBatch((batch) => records.push(...batch.records), name)

  const env = testEnv({ DB: core.db, SECRETS: secrets })
  const ctx = buildPluginContext({
    plugin: name,
    capabilities: new CapabilityRegistry(),
    core: services,
    env,
    onUndo: (undo) => void undos.push(undo),
    // Both tiers get storage passed the same way as in production: the caller derives the handle and
    // the binding carries the loader's raw one (server/pluginHost/context.ts).
    ...(permissions ? { loaded: { permissions, storage, ...(options.destinations ? { destinations: options.destinations } : {}) } } : {}),
    storage,
  })

  // A shallow copy of the host's context with the test handles alongside. The nested seams are the same
  // objects the host built, so behaviour matches. The price is that a plugin's init(), handed this, can
  // also see `db`, `env` and `cleanup`.
  return {
    ...ctx,
    db: core.db,
    env,
    dataDir,
    encryptionKey: TEST_ENCRYPTION_KEY,
    // A getter, because the collector hands records to sinks on its own timer and at its record
    // cap. Flushing on read is what lets a test emit and assert on the next line.
    get recorded() {
      flushTelemetry()
      return records
    },
    cleanup: () => {
      recorder.dispose()
      clearRegistrations(name)
      // Newest first, like the host's own rollback: the last claim on a slot is the one currently held.
      for (const undo of undos.reverse()) undo()
      undos.length = 0
      try {
        opened?.close()
      } catch {
        // A test may have disposed the plugin already, which closes it.
      }
      core.cleanup()
      if (!options.dataDir) {
        try {
          rmSync(dataDir, { recursive: true, force: true })
        } catch {
          // Best effort. The OS reaps tmpdir anyway.
        }
      }
    },
  }
}

export type TestRequestContextOptions = {
  // Which plugin the runtime is bound to. The provider-ownership checks are the real ones, so a
  // provider this plugin has not registered is refused here exactly as it is in production.
  plugin: string
  // What the route reads: DB and SECRETS at minimum, for a provider call that touches core's tables.
  // `ctx.env` from makeTestNodeContext is the usual argument.
  env?: Env
  principal?: Principal
  // Canned answers for the provider calls a test cannot make for real, such as a vendor API it has no
  // token for. They sit on top of the real runtime, so anything not stubbed still goes through the
  // host's checks. Typed against PluginProviderRuntime, so a signature change breaks the test rather
  // than being absorbed by an `as never`.
  providers?: Partial<PluginProviderRuntime>
}

// A `PluginRequestContext` as the host builds it, for driving a loaded plugin's fetch handler
// (docs/plugins.md § What is published, and what acorn promises about it).
//
// Async because it goes through a one-route Hono app. `pluginRequestContext()` takes a Hono `Context`,
// and standing one up for real is cheaper, and truer, than casting an object literal into the shape.
export async function makeTestRequestContext(options: TestRequestContextOptions): Promise<PluginRequestContext> {
  const principal: Principal = options.principal ?? { kind: 'device', userId: 'owner-1', deviceId: 'device-1' }
  const captured: { context?: PluginRequestContext } = {}
  const app = new Hono<AppEnv>()
  app.all('*', (c) => {
    // Seeded exactly as authMiddleware would, which is also what testGate does for a mounted router.
    c.set('principal', principal)
    captured.context = pluginRequestContext(c, options.plugin)
    return c.body(null, 204)
  })
  await app.fetch(new Request('http://plugin.test/'), options.env ?? testEnv())
  const context = captured.context
  if (!context) throw new Error('the test request context was never built: Hono did not reach the capture handler')
  return options.providers ? { ...context, providers: { ...context.providers, ...options.providers } } : context
}
