import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/server/core/index.ts'
import { pluginInstallRoot } from '@acorn/node-core/server/plugins/installer.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { Scheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'
import { agentDriverRegistry } from '@acorn/plugin-agents/testkit'
import { assembleNodeGraph } from '../../src/composition/composition'

// The acceptance test for harness contributions (docs/managed-agents.md § Harnesses). The opencode
// plugin from docs/plugin-authoring.md § Harnesses goes on disk, through the real composition root,
// and lands beside Claude and Codex.
//
// This is the whole plugin: one manifest, one icon path, no node bundle, no client bundle, no build
// step, no `exec` grant. If it needs a second file to pass, the seam is not finished.
const OPENCODE = {
  id: 'opencode',
  name: 'OpenCode',
  version: '0.1.0',
  apiVersion: PLUGIN_API_MAJOR,
  icon: { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z' },
  contributions: {
    harnesses: [
      {
        id: 'opencode',
        label: 'OpenCode',
        spawn: { command: 'opencode', args: ['acp'] },
        envPassthrough: ['OPENCODE_*'],
        quirks: { manualCompaction: true },
        terminal: { command: 'opencode' },
      },
    ],
  },
}

const deps = () => ({
  agents: { internalEnv: () => ({}), memoryReviewTrigger: async () => undefined },
  notes: { internalEnv: () => ({}) },
  terminal: {
    internalEnv: () => ({}),
    launchInjector: async () => undefined,
    memoryReviewTrigger: async () => undefined,
    reconciled: Promise.resolve(),
  },
  workflows: {
    internalEnv: () => ({}),
    reconciled: Promise.resolve(),
    memoryReviewTrigger: async () => undefined,
    failingChecks: async () => null,
  },
}) as never

describe('a data-only harness plugin', () => {
  let dataRoot = ''
  let core: TestDb
  let plugins: Awaited<ReturnType<typeof initPlugins>> | null = null

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-harness-plugin-'))
    core = makeTestDb()
    const dir = join(pluginInstallRoot(dataRoot), 'opencode')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify(OPENCODE, null, 2))
  })

  afterEach(async () => {
    await plugins?.dispose()
    plugins = null
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('reaches the driver registry beside the built-in harnesses, namespaced by its plugin id', async () => {
    const graph = await assembleNodeGraph(dataRoot, deps())
    expect(graph.failures).toEqual([])

    const capabilities = new CapabilityRegistry()
    // Provided before the plugins and never started. Agents registers its usage-refresh schedule during
    // init, and this suite asserts on registration, not on firing.
    capabilities.provide(SCHEDULER, new Scheduler(core.db))
    plugins = await initPlugins(graph.plugins, {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore() }),
      dataDir: dataRoot,
      loaded: graph.loaded,
    })
    expect(plugins.failed).toEqual([])

    // The two built-in ids stay bare because both are persisted. Only the host mints the namespaced
    // name for a contributed one.
    expect(agentDriverRegistry.providers()).toEqual(['claude', 'codex', 'opencode:opencode'])

    const driver = agentDriverRegistry.create('opencode:opencode')!
    const descriptor = await driver.probe()
    expect(descriptor).toMatchObject({
      id: 'opencode:opencode',
      profileId: 'opencode:opencode',
      label: 'OpenCode',
      // The same shared driver Claude runs on. Nothing downstream can tell which feeder answered.
      driverKind: 'acp',
    })
    // Declared `manualCompaction`, so the pane may offer Compact. Declared no session persistence, so
    // resume is absent. Neither came from a list of ids inside acorn.
    expect(descriptor.capabilities).toContain('compact')
    expect(descriptor.capabilities).not.toContain('resume')

    // A real plugin row is why a manifest-only package goes through the host: it is listed, and the
    // owner can turn it off.
    expect(plugins.roster.find((row) => row.name === 'opencode')).toMatchObject({ state: 'active', required: false })
  })

  it('takes its harness away when the owner disables it', async () => {
    const graph = await assembleNodeGraph(dataRoot, deps())
    const capabilities = new CapabilityRegistry()
    capabilities.provide(SCHEDULER, new Scheduler(core.db))
    plugins = await initPlugins(graph.plugins, {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore() }),
      dataDir: dataRoot,
      loaded: graph.loaded,
      disabled: ['opencode'],
    })

    expect(plugins.skipped).toContain('opencode')
    expect(agentDriverRegistry.providers()).toEqual(['claude', 'codex'])
  })
})
