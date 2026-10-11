import { access, mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretService, makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { expect, it } from 'vitest'
import { McpPackageManager } from './mcpPackageManager'
import { AgentMcpServerStore } from './mcpServerStore'
import type { McpInstalledPackage } from './mcpPackageInstall'

it('keeps an older installed version for a live provider until its retirement', async () => {
  const data = await mkdtemp(join(tmpdir(), 'acorn-mcp-lifetime-'))
  const db = makeTestPluginDb('agents')
  try {
    const store = new AgentMcpServerStore(db.db, new SecretService('55'.repeat(32)), data)
    const manager = new McpPackageManager(data, process.execPath, store)
    const installed = (version: string, installationId: string): McpInstalledPackage => {
      const lockDigest = 'a'.repeat(64)
      const root = join(data, `${lockDigest}-${installationId}`)
      return {
        coordinate: { name: 'fixture', version },
        graph: [],
        bins: ['fixture'],
        bin: 'fixture',
        lockDigest,
        treeDigest: 'b'.repeat(64),
        registry: 'https://registry.npmjs.org/',
        runtime: process.version,
        policyVersion: 1,
        installer: process.execPath,
        exceptions: [],
        root,
        installationId,
        entry: join(root, 'fixture.mjs'),
        entryDigest: 'c'.repeat(64),
      }
    }
    const old = installed('1.0.0', '11111111-1111-4111-8111-111111111111')
    const next = installed('2.0.0', '22222222-2222-4222-8222-222222222222')
    await mkdir(old.root)
    await mkdir(next.root)
    const saved = await store.saveManaged('fixture', old, [], true, null)
    await expect(store.saveManaged('fixture', next, [], true, 'wrong revision')).rejects.toThrow(
      'changed before activation',
    )
    expect((await store.get('fixture'))?.managed?.version).toBe('1.0.0')
    const retire = store.holdManagedRoots([old.root])
    await store.saveManaged('fixture', next, [], true, saved.revision)
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await utimes(old.root, oldTime, oldTime)
    await manager.cleanOrphans()
    await expect(access(old.root)).resolves.toBeUndefined()
    retire()
    await manager.cleanOrphans()
    await expect(access(old.root)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(next.root)).resolves.toBeUndefined()
  } finally {
    db.cleanup()
    await rm(data, { recursive: true, force: true })
  }
})
