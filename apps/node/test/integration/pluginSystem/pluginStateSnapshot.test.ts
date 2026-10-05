import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'
import { inputGrantsStore, pluginDir, scanInstalled } from '@acorn/node-core/server/plugins'
import { pluginState } from '@acorn/node-core/server/pluginHost'
import type { PluginRosterEntry } from '@acorn/node-core/server/pluginHost/host.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { buildPluginStateBridge } from '../../../src/composition/pluginState'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const roster: PluginRosterEntry[] = [{ name: 'widget', required: false, disabled: false, state: 'active' }]
let root = ''

const putPackage = (version: string, bytes: string): void => {
  const dir = pluginDir(root, 'widget')
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id: 'widget', name: 'Widget', version, baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
    node: './dist/node.js', client: './dist/client.js',
  }))
  writeFileSync(join(dir, 'dist/node.js'), 'export default { name: "widget", init() {} }')
  writeFileSync(join(dir, 'dist/client.js'), bytes)
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('plugin state composition', () => {
  it('retains active declaration and client bytes across update and uninstall', async () => {
    root = mkdtempSync(join(tmpdir(), 'acorn-plugin-state-'))
    const oldBytes = 'export default { version: 1 }'
    const newBytes = 'export default { version: 2 }'
    putPackage('1.0.0', oldBytes)
    const booted = scanInstalled(root).installed
    expect(booted).toHaveLength(1)
    const bridge = await buildPluginStateBridge({
      dataDir: root,
      db: {} as AppDatabase,
      roster: () => roster,
      booted: () => booted,
      loadFailures: () => [],
      disabled: () => [],
      setDisabled: () => {},
      reloadHost: { reload: async () => ({ ok: false, error: 'not wired in this test' }) },
    })

    putPackage('2.0.0', newBytes)
    const updated = pluginState(bridge).plugins[0]!
    expect(updated).toMatchObject({ state: 'pending-restart', active: { version: '1.0.0', client: { hash: hash(oldBytes) } }, installed: { version: '2.0.0', client: { hash: hash(newBytes) } } })
    expect(new TextDecoder().decode((await bridge.clientBundle('widget', hash(oldBytes)))!.bytes)).toBe(oldBytes)
    expect(new TextDecoder().decode((await bridge.clientBundle('widget', hash(newBytes)))!.bytes)).toBe(newBytes)

    rmSync(pluginDir(root, 'widget'), { recursive: true })
    const uninstalled = pluginState(bridge).plugins[0]!
    expect(uninstalled.active?.client?.hash).toBe(hash(oldBytes))
    expect(uninstalled.installed).toBeUndefined()
    expect(new TextDecoder().decode((await bridge.clientBundle('widget', hash(oldBytes)))!.bytes)).toBe(oldBytes)
    expect(await bridge.clientBundle('widget', hash(newBytes))).toBeNull()
  })

  it('drops the input grant on uninstall, so a later package under the same id asks again', async () => {
    root = mkdtempSync(join(tmpdir(), 'acorn-plugin-state-'))
    putPackage('1.0.0', 'export default {}')
    const bridge = await buildPluginStateBridge({
      dataDir: root,
      db: {} as AppDatabase,
      roster: () => roster,
      booted: () => [],
      loadFailures: () => [],
      disabled: () => [],
      setDisabled: () => {},
      reloadHost: { reload: async () => ({ ok: false, error: 'not wired in this test' }) },
    })
    bridge.inputGrants().set({ pluginId: 'widget', sources: { board: { pulls: { source: 'github:pull-requests', optional: false } } }, grantedAt: 1, grantedBy: 'device:d1' })
    await bridge.uninstall('widget', { purgeData: false })
    expect(inputGrantsStore(root).get('widget')).toBeUndefined()
  })
})
