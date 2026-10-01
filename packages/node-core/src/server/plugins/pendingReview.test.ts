import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPlugin, pluginDir, uninstallPlugin, updatePlugin } from './installer'
import { loadExternalPlugins } from './loader'
import { PLUGIN_API_MAJOR } from './manifest'
import { createPluginReloader } from './reload'
import { approvePluginReview, hasPendingPluginReview, pendingPluginReviewIds, pluginReviewFingerprint, readPendingPluginReview } from './pendingReview'

let root = ''
let source = ''
const id = 'review-fixture'
const requestId = '00000000-0000-4000-8000-000000000001'

const writePackage = (version: string, node = true) => {
  mkdirSync(join(source, 'dist'), { recursive: true })
  writeFileSync(join(source, 'acorn-plugin.json'), JSON.stringify({
    id, name: 'Review fixture', version, baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
    ...(node ? { node: './dist/node.js' } : { client: './dist/client.js' }),
  }))
  writeFileSync(join(source, 'dist/node.js'), "throw new Error('REVIEW_FIXTURE_IMPORTED')\n")
  writeFileSync(join(source, 'dist/client.js'), 'export function activate() {}\n')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-pending-review-'))
  source = join(root, 'source')
  writePackage('1.0.0')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('agent-requested plugin quarantine', () => {
  it('publishes a durable gate before a linked package becomes loadable, including boot and reload', async () => {
    await installPlugin(root, { path: source }, { reviewRequestId: requestId })
    const review = readPendingPluginReview(root, id)!
    expect(review).toMatchObject({ requestId, fingerprint: pluginReviewFingerprint(source) })
    expect(hasPendingPluginReview(root, id)).toBe(true)
    // A fresh loader instance stands in for a process restart. The throwing entrypoint would leave
    // a load failure if it were even imported; the candidate stays visible only as installed data.
    const boot = await loadExternalPlugins(root, { builtins: [] })
    expect(boot.installed.map((entry) => entry.manifest.id)).toEqual([id])
    expect(boot.loaded).toEqual([])
    expect(boot.failures).toEqual([])
    const reloader = createPluginReloader({
      dataDir: root, builtins: [], host: { reload: async () => { throw new Error('must not call host') } },
    })
    await expect(reloader.reload(id)).rejects.toThrow(`No plugin '${id}'`)
    expect(() => approvePluginReview(root, id, review.reviewId, review.fingerprint)).not.toThrow()
    const approved = await loadExternalPlugins(root, { builtins: [] })
    expect(approved.failures[0]?.reason).toContain('REVIEW_FIXTURE_IMPORTED')
  })

  it('rejects an update or replacement while review is pending and binds approval to full package bytes', async () => {
    await installPlugin(root, { path: source }, { reviewRequestId: requestId })
    const review = readPendingPluginReview(root, id)!
    await expect(updatePlugin(root, id)).rejects.toThrow('unreviewed package')
    await expect(installPlugin(root, { path: source })).rejects.toThrow('unreviewed package')
    writeFileSync(join(source, 'dist/node.js'), "throw new Error('CHANGED_AFTER_REVIEW')\n")
    expect(pluginReviewFingerprint(source)).not.toBe(review.fingerprint)
    expect(() => approvePluginReview(root, id, review.reviewId, pluginReviewFingerprint(source))).toThrow('changed')
    expect(hasPendingPluginReview(root, id)).toBe(true)
  })

  it('stages an update and removes the package and gate on rejection', async () => {
    await installPlugin(root, { path: source })
    writePackage('2.0.0')
    await updatePlugin(root, id, { reviewRequestId: requestId })
    expect(readPendingPluginReview(root, id)).toMatchObject({ requestId })
    const boot = await loadExternalPlugins(root, { builtins: [] })
    expect(boot.loaded).toEqual([])
    expect(boot.installed[0]?.manifest.version).toBe('2.0.0')
    expect(uninstallPlugin(root, id)).toEqual({ restartRequired: true, dataPurged: false })
    expect(existsSync(pluginDir(root, id))).toBe(false)
    expect(hasPendingPluginReview(root, id)).toBe(false)
  })

  it('keeps an orphan or corrupt marker inert and removable after an interrupted install', async () => {
    await installPlugin(root, { path: source }, { reviewRequestId: requestId })
    rmSync(pluginDir(root, id), { recursive: true, force: true })
    expect(pendingPluginReviewIds(root)).toEqual([id])
    expect(uninstallPlugin(root, id)).toMatchObject({ restartRequired: true })
    expect(hasPendingPluginReview(root, id)).toBe(false)

    await installPlugin(root, { path: source }, { reviewRequestId: requestId })
    writeFileSync(join(root, 'plugins', `${id}.pending-review.json`), '{broken')
    expect(readPendingPluginReview(root, id)).toBeNull()
    expect(hasPendingPluginReview(root, id)).toBe(true)
    expect((await loadExternalPlugins(root, { builtins: [] })).loaded).toEqual([])
    expect(uninstallPlugin(root, id)).toMatchObject({ restartRequired: true })
    expect(hasPendingPluginReview(root, id)).toBe(false)
  })

  it('holds a client-only package too', async () => {
    writePackage('1.0.0', false)
    await installPlugin(root, { path: source }, { reviewRequestId: requestId })
    const loaded = await loadExternalPlugins(root, { builtins: [] })
    expect(loaded.loaded).toEqual([])
    expect(loaded.installed[0]?.manifest.client).toBe('./dist/client.js')
    expect(hasPendingPluginReview(root, id)).toBe(true)
  })
})
