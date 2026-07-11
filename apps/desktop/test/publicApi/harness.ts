import { createAutomationApp } from '../../src/core/server/publicApi/app'
import { buildCoreResourceContribution } from '../../src/core/server/publicApi/coreResources'
import { buildCoreIntegrationsContribution } from '../../src/core/server/publicApi/coreIntegrations'
import { buildCoreCommandsContribution } from '../../src/core/server/publicApi/coreCommands'
import type { ApiSettingsController, CoreSystemDeps } from '../../src/core/server/publicApi/coreSystem'
import { buildCoreSystemContribution } from '../../src/core/server/publicApi/coreSystem'
import type { PluginApiContribution } from '../../src/core/server/publicApi/defineEndpoint'
import { IdempotencyStore } from '../../src/core/server/publicApi/idempotency'
import { AutomationApiRegistry, type RegistrySnapshot } from '../../src/core/server/publicApi/registry'
import { TaskService } from '../../src/core/server/publicApi/services/taskService'
import { WorkspaceService } from '../../src/core/server/publicApi/services/workspaceService'
import { TokenService } from '../../src/core/server/publicApi/tokenService'
import { makeTestDb, type TestDb } from '../../src/core/server/routes/testDb'

// Public API test harness (docs/next/api/implementation-plan.md §1). Builds a fully-wired
// automation app over a temp DB with fake runtime/settings — no Electron. Used by the conformance
// suite and endpoint tests.

export const HOST = '127.0.0.1:4318'

const settingsStub: ApiSettingsController = {
  read: () => ({ enabled: true, port: 4318, effectivePort: 4318, bindAddress: HOST, portOverridden: false }),
  patch: async () => ({ enabled: true, port: 4318, effectivePort: 4318, bindAddress: HOST, portOverridden: false, rebound: false }),
}

export type Harness = {
  app: ReturnType<typeof createAutomationApp>
  snapshot: RegistrySnapshot
  tokens: TokenService
  readToken: string
  writeToken: string
  db: TestDb['db']
  cleanup: () => void
  request(path: string, init?: RequestInit, token?: string): Promise<Response>
}

export async function makeHarness(extra: { owner: string; contribution: PluginApiContribution }[] = []): Promise<Harness> {
  const t = makeTestDb()
  const tokens = new TokenService(t.db)
  const readToken = (await tokens.create({ userId: 'octocat', name: 'r', scopes: ['read'], expiresAt: null })).token
  const writeToken = (await tokens.create({ userId: 'octocat', name: 'w', scopes: ['read', 'write'], expiresAt: null })).token

  const registry = new AutomationApiRegistry()
  const coreDeps: CoreSystemDeps = {
    runtime: {
      version: '0.0.0-test',
      startedAt: 0,
      desktop: false,
      reconciliationComplete: () => true,
      rendererConnected: () => false,
      terminalAvailable: () => false,
      worktreesAvailable: () => false,
      pluginCapabilities: () => [],
      shuttingDown: () => false,
    },
    settings: settingsStub,
    getSnapshot: () => registry.freeze(),
  }
  registry.registerContribution(buildCoreSystemContribution(coreDeps), 'core')
  registry.registerContribution(
    buildCoreResourceContribution({ db: t.db, workspaces: new WorkspaceService(t.db), tasks: new TaskService(t.db) }),
    'core',
  )
  registry.registerContribution(buildCoreIntegrationsContribution(t.db, '0'.repeat(64)), 'core')
  registry.registerContribution(buildCoreCommandsContribution({ getSnapshot: () => registry.freeze() }), 'core')
  for (const { owner, contribution } of extra) registry.registerContribution(contribution, owner)

  const snapshot = registry.freeze()
  const app = createAutomationApp({ snapshot, tokens, idempotency: new IdempotencyStore(t.db), allowedHost: HOST })

  return {
    app,
    snapshot,
    tokens,
    readToken,
    writeToken,
    db: t.db,
    cleanup: () => t.cleanup(),
    request(path, init = {}, token) {
      const headers = new Headers(init.headers)
      headers.set('host', HOST)
      if (token) headers.set('authorization', `Bearer ${token}`)
      return Promise.resolve(app.fetch(new Request(`http://${HOST}${path}`, { ...init, headers }), {} as Env))
    },
  }
}

// Substitute a concrete value for each `:param` so a route matches during conformance probes.
export function fillPath(path: string): string {
  const full = path.startsWith('/plugins') ? path : path
  return full.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) =>
    /id$/i.test(name) ? '00000000-0000-0000-0000-000000000000' : 'x',
  )
}
