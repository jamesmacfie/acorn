import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentProfileRegistry } from '@acorn/node-core/server/agentProfiles/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { launcherSpec } from '@acorn/node-core/server/mcpRegister.ts'
import { markPluginUserManaged } from '@acorn/node-core/server/plugins'
import { pluginDir } from '@acorn/node-core/server/plugins'
import { PLUGIN_API_MAJOR } from '@acorn/node-core/server/plugins'
import { openDataRoot } from '@acorn/node-core/server/storage'
import { makeTestDb } from '@acorn/node-core/testkit'
import { wireAgentTools } from '@acorn/node-core/server/agentTools'
import { bootNode, type BootNodeOptions } from '../../../src/composition/boot'
import { reconcileBundledPackages } from '../../../src/composition/composition'
import { effectiveDisabled } from '../../../src/composition/pluginState'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'

// What each entry passes bootNode, less the data root: ../../../src/composition/runtime.ts for the
// supervised Node and ../../../src/entries/standalone.ts for the standalone one.
const hosts: Record<'supervised' | 'standalone', Omit<BootNodeOptions, 'root'>> = {
  supervised: {
    appVersion: 'test',
    keys: { sessionKey: '0'.repeat(64), signingKey: 'boot-test-signing-key-0123456789' },
    development: true,
    loginShellPath: false,
    mcp: { name: 'acorn-test', launcher: launcherSpec(process.execPath, '/unused/mcp.js', 'acorn-test') },
  },
  standalone: { development: true, loginShellPath: false },
}

describe.each(Object.entries(hosts))('a %s Node booted through bootNode', (_host, options) => {
  const original = { key: process.env.SESSION_ENC_KEY, port: process.env.ACORN_PORT }
  let dataDir = ''
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-boot-'))
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    delete process.env.ACORN_PORT
  })
  afterEach(() => {
    if (original.key == null) delete process.env.SESSION_ENC_KEY
    else process.env.SESSION_ENC_KEY = original.key
    if (original.port != null) process.env.ACORN_PORT = original.port
    rmSync(dataDir, { recursive: true, force: true })
  })

  // The standalone drain once skipped the task script close, so a setup attempt pending at SIGTERM
  // read as interrupted by `restart` on the next boot. The second boot here is that next boot, and
  // taking the data root lock at all proves the first one released it.
  it('records a pending setup attempt as interrupted by shutdown, and releases the data root', async () => {
    const first = await bootNode({ ...options, root: openDataRoot(dataDir) })
    let attemptId: string | null = null
    try {
      // After reconcile, which would otherwise mark the fresh attempt as interrupted by `restart`.
      await first.reconciled
      const db = first.runtime.DB
      const now = Date.now()
      db.insert(schema.workspaces).values({ id: 'w', name: 'Fixture', createdAt: now, updatedAt: now }).run()
      db.insert(schema.projects).values({ id: 'p', name: 'Fixture', workspaceId: 'w', setupScript: 'pnpm install', createdAt: now, updatedAt: now }).run()
      db.insert(schema.tasks).values({ id: 'task', title: 'Fixture', projectId: 'p', origin: 'local', status: 'active',
        branch: 'fixture', worktreePath: dataDir, createdAt: now, updatedAt: now }).run()
      // A failed first run, so setup may be started again by hand.
      db.insert(schema.taskScriptAttempts).values({ attemptId: 'failed', taskId: 'task', phase: 'setup', generation: 1,
        state: 'failed', reason: 'nonzero_exit', requestedAt: now }).run()
      const pending = await first.core.taskScripts.admitManualSetup('task')
      expect(pending).toMatchObject({ state: 'starting' })
      attemptId = pending.attemptId
    } finally {
      await first.stop()
    }

    const second = await bootNode({ ...options, root: openDataRoot(dataDir) })
    try {
      await second.reconciled
      const attempt = second.runtime.DB.select().from(schema.taskScriptAttempts).where(eq(schema.taskScriptAttempts.attemptId, attemptId!)).get()
      expect(attempt).toMatchObject({ state: 'interrupted', reason: 'shutdown' })
    } finally {
      await second.stop()
    }
  }, 60_000)
})

describe('plugin-state parity', () => {
  // bootNode builds the PLUGIN_STATE bridge for both hosts. What still differs is what each host
  // passes in. There are exactly two such deltas, both asserted here.
  it('unions the file with the start-config override, and the file alone when there is none', () => {
    const store = { get: () => ['github'], set: () => {} }
    // The supervised root: a start config may pin a list without writing one (`dev:node`, an integration
    // harness). Reporting only the file made restartRequired permanently true.
    expect(effectiveDisabled(store, ['rollbar']).call(null).sort()).toEqual(['github', 'rollbar'])
    // The standalone root: nothing hands a service-managed node a list, so the file is the whole answer.
    expect(effectiveDisabled(store)()).toEqual(['github'])
  })

  it('reconciles bundled packages only when a bundled root is configured', () => {
    // Both roots now call the same reporter, so the account of what reconciliation did cannot exist
    // on one root only. What still differs is the input: the supervised root always has application
    // resources, while a standalone node's bundled root comes from the environment and is unset on
    // every service-managed node, the documented "there is nothing to reconcile from" case
    // (docs/node-distribution.md § Plugins).
    const dataRoot = mkdtempSync(join(tmpdir(), 'acorn-parity-data-'))
    const resources = mkdtempSync(join(tmpdir(), 'acorn-parity-resources-'))
    try {
      mkdirSync(join(resources, 'rollbar', 'dist'), { recursive: true })
      writeFileSync(join(resources, 'rollbar/acorn-plugin.json'), JSON.stringify({
        id: 'rollbar', name: 'Rollbar', version: '1.0.0', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR, node: './dist/node.js',
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
    //
    // Read off `console.error`, not `console.log`: every line the node writes goes to stderr
    // through the logger now, because stdout is a wire (docs/telemetry/logging.md § Logging).
    const dataRoot = mkdtempSync(join(tmpdir(), 'acorn-parity-frozen-'))
    const lines: string[] = []
    const write = console.error
    console.error = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      markPluginUserManaged(dataRoot, 'rollbar')
      reconcileBundledPackages({ dataDir: dataRoot, bundledRoot: undefined, development: true })
    } finally {
      console.error = write
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
      wireAgentTools({ db: db.db, secrets: db.secrets })
      const names = agentToolContributions().map((tool) => tool.name)
      expect(names).toEqual(expect.arrayContaining(['task_context', 'linked_issues', 'repo_info']))
    } finally {
      db.cleanup()
    }
  })
})
