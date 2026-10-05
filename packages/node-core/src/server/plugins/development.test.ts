import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginReloadResult } from '@acorn/protocol/api.ts'
import { createPluginDevelopment, type PluginDevelopment } from './development'
import { developmentPlugins, recordPluginLog } from './developmentState'
import { inputGrantsStore } from './inputGrants'
import { installPlugin, pluginInstallRoot } from './installer'
import { PLUGIN_API_MAJOR } from './manifest'

// Real files, a real folder install, and real polling, because what's under test is what the node does
// when an author saves.

let root = ''
let workshop = ''
let development: PluginDevelopment | undefined

const board = {
  sourceId: 'board', name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue', handler: '/v1/p/readiness/board',
  inputs: { pulls: { source: 'github:pull-requests', label: 'Pull requests' } },
}

function packageDir(): string {
  const dir = mkdtempSync(join(workshop, 'pkg-'))
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: 'readiness', name: 'Readiness', version: '1.0.0', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
    node: './dist/node.js', contributions: { dataSources: [board] },
  }))
  writeFileSync(join(dir, 'dist', 'node.js'), 'export default { name: "readiness", init() {} }\n')
  return dir
}

const start = (reload: (id: string) => Promise<PluginReloadResult>) => (development = createPluginDevelopment({ dataDir: root, reload }))
const reloaded = (id: string): Promise<PluginReloadResult> => Promise.resolve({ id, version: '1.0.0', state: 'reloaded' })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-dev-root-'))
  workshop = mkdtempSync(join(tmpdir(), 'acorn-dev-pkg-'))
})
afterEach(() => {
  development?.dispose()
  development = undefined
  rmSync(root, { recursive: true, force: true })
  rmSync(workshop, { recursive: true, force: true })
})

describe('development mode', () => {
  it('is only for a node plugin installed from a folder', async () => {
    const source = packageDir()
    // Copied in by hand, so there's no folder lockfile behind it.
    cpSync(source, join(pluginInstallRoot(root), 'readiness'), { recursive: true })
    const dev = start(reloaded)
    expect(dev.state('readiness')).toBeUndefined()
    expect(() => dev.set('readiness', true)).toThrow('installed from a local folder')
    rmSync(join(pluginInstallRoot(root), 'readiness'), { recursive: true })
    await installPlugin(root, { path: source })
    expect(dev.state('readiness')).toEqual({ on: false })
    dev.set('readiness', true)
    expect(dev.state('readiness')).toEqual({ on: true })
    expect(developmentPlugins(root)).toEqual(['readiness'])
  })

  it('reloads once after a burst of saves, and keeps watching after a failed reload', async () => {
    const source = packageDir()
    await installPlugin(root, { path: source })
    const reload = vi.fn(reloaded)
    const dev = start(reload)
    dev.set('readiness', true)
    writeFileSync(join(source, 'dist', 'node.js'), 'export default { name: "readiness", init() { /* 1 */ } }\n')
    writeFileSync(join(source, 'acorn-plugin.json'), JSON.stringify({
      id: 'readiness', name: 'Readiness', version: '1.0.0', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR, node: './dist/node.js', contributions: { dataSources: [board] },
    }))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(dev.state('readiness')?.reloadedAt).toBeTypeOf('number')

    reload.mockRejectedValueOnce(new Error('SyntaxError in dist/node.js'))
    writeFileSync(join(source, 'dist', 'node.js'), 'export default {\n')
    await vi.waitFor(() => expect(dev.state('readiness')?.failure?.reason).toContain('SyntaxError'), { timeout: 5_000 })
    writeFileSync(join(source, 'dist', 'node.js'), 'export default { name: "readiness", init() { /* 2 */ } }\n')
    await vi.waitFor(() => expect(dev.state('readiness')?.failure).toBeUndefined(), { timeout: 5_000 })
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('runs one reload at a time, from a save or the route, and records the route\'s too', async () => {
    await installPlugin(root, { path: packageDir() })
    let running = 0
    let most = 0
    const dev = start(async (id) => {
      most = Math.max(most, ++running)
      await new Promise((resolve) => setTimeout(resolve, 20))
      running--
      return { id, version: '1.0.0', state: 'reloaded' }
    })
    dev.set('readiness', true)
    await Promise.all([dev.reload('readiness'), dev.reload('readiness'), dev.reload('readiness')])
    expect(most).toBe(1)
    expect(dev.state('readiness')?.reloadedAt).toBeTypeOf('number')
  })

  it('approves the declared inputs with a development grant, and removes it when the mode ends', async () => {
    await installPlugin(root, { path: packageDir() })
    const dev = start(reloaded)
    dev.set('readiness', true)
    expect(inputGrantsStore(root).get('readiness')).toMatchObject({
      development: true, sources: { board: { pulls: { source: 'github:pull-requests', optional: false } } },
    })
    dev.set('readiness', false)
    expect(inputGrantsStore(root).get('readiness')).toBeUndefined()
    expect(developmentPlugins(root)).toEqual([])
  })

  it('keeps the last 500 log lines while on, and none after', async () => {
    await installPlugin(root, { path: packageDir() })
    const dev = start(reloaded)
    recordPluginLog('readiness', 'info', 'before')
    expect(dev.logs('readiness')).toBeNull()
    dev.set('readiness', true)
    for (let index = 0; index < 501; index++) recordPluginLog('readiness', 'warn', `line ${index}`)
    const lines = dev.logs('readiness')!
    expect(lines).toHaveLength(500)
    expect(lines[0]).toMatchObject({ level: 'warn', message: 'line 1' })
    dev.set('readiness', false)
    expect(dev.logs('readiness')).toBeNull()
  })

  it('watches again after a restart', async () => {
    await installPlugin(root, { path: packageDir() })
    start(reloaded).set('readiness', true)
    development!.dispose()
    expect(start(reloaded).state('readiness')).toEqual({ on: true })
  })
})
