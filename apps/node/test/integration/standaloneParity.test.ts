import { describe, expect, it } from 'vitest'
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { makeTestDb } from '@acorn/node-core/testkit/db.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { NODE_DRAIN_ORDER, assembleNodeGraph, nodePluginNames } from '../../src/server/composition'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'

describe('composition graph parity', () => {
  it('uses one plugin graph and one drain order for both Node hosts', () => {
    const graph = assembleNodeGraph('', {} as never)
    expect(graph.plugins.map((plugin) => plugin.name)).toEqual(nodePluginNames())
    expect(graph.drainOrder).toEqual(NODE_DRAIN_ORDER)
    expect(NODE_DRAIN_ORDER).toEqual(['listener', 'reconciliation', 'plugin state', 'plugins', 'sqlite', 'data root'])
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
