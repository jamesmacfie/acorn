import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { makeTestDb } from '@acorn/node-core/testkit/db.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { NODE_DRAIN_ORDER, assembleNodeGraph, nodePluginNames } from '../../src/server/composition'
import { effectiveDisabled } from '../../src/server/pluginState'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'

describe('composition graph parity', () => {
  it('uses one plugin graph and one drain order for both Node hosts', async () => {
    // No install directory at this data root, so the loader contributes nothing and the graph is
    // exactly the compiled-in list — which is the assertion that matters here.
    const graph = await assembleNodeGraph('', {} as never)
    expect(graph.plugins.map((plugin) => plugin.name)).toEqual(nodePluginNames())
    expect(graph.loaded.size).toBe(0)
    expect(graph.drainOrder).toEqual(NODE_DRAIN_ORDER)
    expect(NODE_DRAIN_ORDER).toEqual(['listener', 'reconciliation', 'plugin state', 'plugins', 'sqlite', 'data root'])
  })
})

describe('plugin-state parity', () => {
  // Both roots build the PLUGIN_STATE bridge through buildPluginStateBridge, so the copies cannot drift
  // again. What CAN still differ is what each root passes in, and there are exactly two such deltas —
  // both deliberate, both asserted here so the third one is a red test rather than an archaeology dig.
  it('unions the file with the start-config override, and the file alone when there is none', () => {
    const store = { get: () => ['github'], set: () => {} }
    // The Electron root: a start config may pin a list without writing one (`dev:node`, an integration
    // harness). Reporting only the file made restartRequired permanently true.
    expect(effectiveDisabled(store, ['rollbar']).call(null).sort()).toEqual(['github', 'rollbar'])
    // The standalone root: nothing hands a service-managed node a list, so the file is the whole answer.
    expect(effectiveDisabled(store)()).toEqual(['github'])
  })

  it('does not reconcile bundled packages on a standalone node', async () => {
    // The Electron root calls reconcileBundledPlugins with config.bundledPluginsDir; a standalone node
    // has no resourcesPath to reconcile FROM, so there is deliberately no such call (docs/node-distribution.md).
    const source = await readFile(new URL('../../src/server/standalone.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('reconcileBundledPlugins')
  })
})

describe('what the shared composition populates', () => {
  it('registers the three built-in agent profiles beside core\'s shell', () => {
    registerBuiltInProfiles()
    const ids = agentProfileRegistry.list().map((profile) => profile.id).sort()
    expect(ids).toEqual(expect.arrayContaining(['claude-code', 'codex', 'aider', 'shell']))
  })

  it("registers core's own agent tools under the 'core' owner", () => {
    const db = makeTestDb()
    try {
      wireAgentTools({ db: db.db })
      const names = agentToolContributions().map((tool) => tool.name)
      expect(names).toEqual(expect.arrayContaining(['task_context', 'linked_issues', 'repo_info']))
    } finally {
      db.cleanup()
    }
  })
})
