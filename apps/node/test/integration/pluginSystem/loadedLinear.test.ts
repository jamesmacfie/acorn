import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadExternalPlugins } from '@acorn/node-core/server/plugins'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('loading production plugin bundles from disk', () => {
  let dataRoot = ''
  let dispose: (() => Promise<void> | void) | undefined

  beforeAll(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-linear-dogfood-'))
    for (const pluginId of ['database', 'linear']) {
      execFileSync(process.execPath, [join(NODE_APP, 'scripts/build-plugin.mjs'), pluginId], {
        cwd: NODE_APP,
        env: { ...process.env, ACORN_DATA_DIR: dataRoot },
        stdio: 'pipe',
      })
    }
  }, 120_000)

  afterAll(async () => {
    await dispose?.()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('loads bundles that use createRequire without granting raw node:module authority', async () => {
    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })

    expect(failures).toEqual([])
    expect(loaded.map(entry => entry.manifest.id).sort()).toEqual(['database', 'linear'])
    const linear = loaded.find(entry => entry.manifest.id === 'linear')
    expect(linear?.plugin.name).toBe('linear')
    expect(linear?.manifest.permissions.node.net).toEqual(['api.linear.app', 'uploads.linear.app'])
    dispose = async () => {
      for (const entry of loaded)
        await entry.plugin.dispose?.()
    }
  })
})
