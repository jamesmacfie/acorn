import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { markPluginUserManaged } from '@acorn/node-core/main/bundledPluginState.ts'
import { pluginDir } from '@acorn/node-core/main/pluginInstaller.ts'
import { PLUGIN_API_MAJOR } from '@acorn/node-core/main/pluginManifest.ts'
import { makeTestDb } from '@acorn/node-core/testkit/db.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { NODE_DRAIN_ORDER, assembleNodeGraph, nodePluginNames, reconcileBundledPackages } from '../../src/server/composition'
import { effectiveDisabled } from '../../src/server/pluginState'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'

describe('composition graph parity', () => {
  it('uses one plugin graph and one drain order for both Node hosts', async () => {
    // No install directory at this data root, so the loader contributes nothing and the graph is
    // exactly the compiled-in list, which is the assertion that matters here.
    const graph = await assembleNodeGraph('', {} as never)
    expect(graph.plugins.map((plugin) => plugin.name)).toEqual(nodePluginNames())
    expect(graph.loaded.size).toBe(0)
    expect(graph.drainOrder).toEqual(NODE_DRAIN_ORDER)
    expect(NODE_DRAIN_ORDER).toEqual(['listener', 'reconciliation', 'schedules', 'plugin state', 'plugins', 'sqlite', 'data root'])
  })
})

describe('plugin-state parity', () => {
  // Both roots build the PLUGIN_STATE bridge through buildPluginStateBridge, so the copies cannot
  // drift again. What can still differ is what each root passes in. There are exactly two such
  // deltas, both asserted here, so a third one shows up as a red test rather than an archaeology dig.
  it('unions the file with the start-config override, and the file alone when there is none', () => {
    const store = { get: () => ['github'], set: () => {} }
    // The Electron root: a start config may pin a list without writing one (`dev:node`, an integration
    // harness). Reporting only the file made restartRequired permanently true.
    expect(effectiveDisabled(store, ['rollbar']).call(null).sort()).toEqual(['github', 'rollbar'])
    // The standalone root: nothing hands a service-managed node a list, so the file is the whole answer.
    expect(effectiveDisabled(store)()).toEqual(['github'])
  })

  it('reconciles bundled packages only when a bundled root is configured', () => {
    // Both roots now call the same reporter, so the account of what reconciliation did cannot exist
    // on one root only. What still differs is the input: the Electron root always has application
    // resources, while a standalone node's bundled root comes from the environment and is unset on
    // every service-managed node, the documented "there is nothing to reconcile from" case
    // (docs/node-distribution.md § Plugins).
    const dataRoot = mkdtempSync(join(tmpdir(), 'acorn-parity-data-'))
    const resources = mkdtempSync(join(tmpdir(), 'acorn-parity-resources-'))
    try {
      mkdirSync(join(resources, 'rollbar', 'dist'), { recursive: true })
      writeFileSync(join(resources, 'rollbar/acorn-plugin.json'), JSON.stringify({
        id: 'rollbar', name: 'Rollbar', version: '1.0.0', apiVersion: PLUGIN_API_MAJOR, node: './dist/node.js',
      }))
      writeFileSync(join(resources, 'rollbar/dist/node.js'), 'export default {}\n')

      reconcileBundledPackages({ dataDir: dataRoot, bundledRoot: undefined, development: true })
      expect(existsSync(pluginDir(dataRoot, 'rollbar'))).toBe(false)

      reconcileBundledPackages({ dataDir: dataRoot, bundledRoot: resources, development: true })
      expect(existsSync(join(pluginDir(dataRoot, 'rollbar'), 'dist/node.js'))).toBe(true)
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
      rmSync(resources, { recursive: true, force: true })
    }
  })

  it('names a package frozen by an ownership row even with no bundled root to refuse an update from', () => {
    // The `preserved` list can only report a package it declined to replace this boot, so a
    // standalone node, which has nothing to replace it with, used to say nothing at all while a
    // `build:plugin` output outlived every later build. The row itself is the fact, so it is read
    // directly.
    const dataRoot = mkdtempSync(join(tmpdir(), 'acorn-parity-frozen-'))
    const lines: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      markPluginUserManaged(dataRoot, 'rollbar')
      reconcileBundledPackages({ dataDir: dataRoot, bundledRoot: undefined, development: true })
    } finally {
      console.log = log
      rmSync(dataRoot, { recursive: true, force: true })
    }
    expect(lines.join('\n')).toContain('NOT taking app updates (installed by the owner on this node): rollbar')
    // The escape hatch, which is a development-build line: for a user this row is correct and permanent.
    expect(lines.join('\n')).toContain('bundled-state.json')
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
