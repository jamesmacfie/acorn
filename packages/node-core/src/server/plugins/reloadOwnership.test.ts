import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { clearRegistrations, initPlugins } from '../pluginHost/host'
import { resolvePluginFetch } from '../routes/registry'
import { isolateNodePlugin } from './isolation'
import { pluginDbPath } from './storage'
import type { NodePlugin, PluginStorage } from '../pluginHost/types'
import type { NodePermissions } from './manifest'

const name = 'ownership-fixture'
const permissions: NodePermissions = { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false }
const storage: PluginStorage = { open() { throw new Error('Worker owns fixture storage') } }
const binding = { permissions, storage }
const workers = () => (process.report.getReport() as { workers: unknown[] }).workers.length
const serving = async () => (await resolvePluginFetch(name, `/v1/p/${name}`)!.fetch(new Request('https://fixture.invalid'), {} as never)).text()

afterEach(() => clearRegistrations(name))

describe('rejected loaded candidate ownership', () => {
  it.each(['unknown', 'disabled', 'init', 'replay', 'ready', 'success'] as const)('closes the owned realm on %s and disposes the committed realm once', async (stage) => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-reload-owner-'))
    const dir = join(root, 'package'), migrations = join(dir, 'migrations'), entrypoint = join(dir, 'node.mjs')
    mkdirSync(join(migrations, 'meta'), { recursive: true })
    writeFileSync(join(migrations, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
    const oldDispose = vi.fn()
    const old: NodePlugin = { name, init(ctx) { ctx.routes.fetch(() => new Response('previous')) }, dispose: oldDispose }
    const host = await initPlugins([old], { capabilities: new CapabilityRegistry(), core: {} as never, dataDir: root,
      loaded: stage === 'unknown' ? new Map() : new Map([[name, binding]]), disabled: stage === 'disabled' ? [name] : [] })
    let candidate: NodePlugin | undefined
    try {
      const baseline = workers()
      const body = stage === 'init' ? "ctx.routes.fetch(() => new Response('candidate')); throw new Error('init rejected')"
        : stage === 'replay' ? "ctx.capabilities.provide('ownership.duplicate', {}); ctx.capabilities.provide('ownership.duplicate', {})"
          : "ctx.routes.fetch(() => new Response('candidate'))"
      writeFileSync(entrypoint, `export default { name: '${name}', init(ctx) { const db = ctx.storage.open(); db.$client.exec("CREATE TABLE IF NOT EXISTS retained_schema (value TEXT); INSERT INTO retained_schema VALUES ('candidate')"); ${body} }, ${stage === 'ready' ? "ready() { throw new Error('ready rejected') }," : ''} dispose() {} };\n`)
      candidate = await isolateNodePlugin({ entrypoint, pluginDir: dir, plugin: name, dataRoot: root, migrationsFolder: migrations, permissions })
      expect(workers()).toBe(baseline + 1)
      const outcome = await host.reload(name, { plugin: candidate, binding })
      expect(outcome.ok).toBe(stage === 'success')
      if (stage === 'success') {
        expect(await serving()).toBe('candidate')
        expect(workers()).toBe(baseline + 1)
      } else {
        await expect.poll(workers).toBe(baseline)
        if (stage === 'unknown' || stage === 'init') {
          expect(await serving()).toBe('previous')
          expect(oldDispose).not.toHaveBeenCalled()
        }
        await candidate.dispose?.()
        expect(workers()).toBe(baseline)
      }
      await host.dispose()
      await candidate.dispose?.()
      await expect.poll(workers).toBe(baseline)
      // Successful initialization can change schema even if registration/ready is rejected. Closing
      // the worker must leave no WAL handle and must preserve that documented schema ceiling.
      if (stage === 'init' || stage === 'replay' || stage === 'ready' || stage === 'success') {
        const db = new DatabaseSync(pluginDbPath(root, name))
        try {
          expect(db.prepare('SELECT COUNT(*) AS count FROM retained_schema').get()?.count).toBe(1)
          expect(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy).toBe(0)
        } finally { db.close() }
      }
      if (stage !== 'disabled') expect(oldDispose).toHaveBeenCalledTimes(1)
    } finally { await candidate?.dispose?.(); await host.dispose(); rmSync(root, { recursive: true, force: true }) }
  })

  it('preserves the replay error, disposes its lifecycle once, and revokes the candidate context', async () => {
    let context!: Parameters<NodePlugin['init']>[0]
    const dispose = vi.fn(() => { throw new Error('cleanup rejected') })
    const host = await initPlugins([{ name, init() {} }], { capabilities: new CapabilityRegistry(), core: {} as never, dataDir: '', loaded: new Map([[name, binding]]) })
    try {
      const result = await host.reload(name, { binding, plugin: { name, init(ctx) { context = ctx; ctx.capabilities.provide('ownership.duplicate', {} as never); ctx.capabilities.provide('ownership.duplicate', {} as never) }, dispose } })
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ownership.duplicate') })
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(() => context.routes.fetch(() => new Response())).toThrow(/replaced by a reload/)
      await host.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally { await host.dispose() }
  })
})
