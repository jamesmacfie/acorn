import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodePlugins } from '../../src/composition/plugins'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/server/core/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { Scheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { makeTestDb, testCoreSeams } from '@acorn/node-core/testkit'

// Initializes every compiled plugin into the process-wide registries, so createApp() mounts their
// routes. For suites that read the assembled mount table. The deps are inert: nothing here starts a
// provider child, a pseudo-terminal, or a workflow run.
//
// A plugin that declares periodic work resolves the scheduler through the capability registry at
// registration time, so a graph assembled without one throws. Both composition roots provide it before
// initPlugins for that reason (docs/schedules.md § Why the node, and only the node). It's never
// started, because a running loop would fire jobs at a temp data root while the assertions run.
export async function initCompiledPlugins(): Promise<{ dispose(): Promise<void> }> {
  const core = makeTestDb()
  const dataDir = mkdtempSync(join(tmpdir(), 'acorn-routes-'))
  const capabilities = new CapabilityRegistry()
  capabilities.provide(SCHEDULER, new Scheduler(core.db))
  const plugins = await initPlugins(
    nodePlugins(dataDir, {
      agents: { internalEnv: () => ({}), reconciled: Promise.resolve() },
      notes: { internalEnv: () => ({}) },
      terminal: { internalEnv: () => ({}), reconciled: Promise.resolve() },
      workflows: { internalEnv: () => ({}), reconciled: Promise.resolve() },
    }),
    {
      capabilities,
      core: createCoreServices({
        secrets: new SecretService('0'.repeat(64)),
        db: core.db,
        activeIdentity: memoryIdentityStore(),
        ...testCoreSeams(),
      }),
      dataDir,
    },
  )
  return {
    // Disposed, not just cleaned up: the terminal plugin opens a WAL-mode SQLite file and starts an
    // idle-watch interval, and the plugin databases have to close before their temp dir is removed.
    async dispose() {
      await plugins.dispose()
      core.cleanup()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
