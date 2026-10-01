import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/plugin/apiVersion.ts'
import type { PluginHostState } from '../../infra/platform'
import { deviceEntries } from './distribution'

const hash = 'a'.repeat(64)
const manifest = {
  id: 'device-board', name: 'Device Board', version: '1.0.0', baseline: ACORN_BASELINE,
  apiVersion: PLUGIN_API_MAJOR, client: 'client.js', contributions: { frames: [] },
}
const state = (raw: unknown): PluginHostState => ({
  cached: { [hash]: { pluginId: 'device-board', version: '1.0.0', bytes: 12, source: { kind: 'device' }, sourceLabel: 'github:owner/board', manifest: raw } },
  acks: [], devGrants: [],
})

afterEach(() => vi.unstubAllGlobals())

describe('client validation of device cache entries', () => {
  it('projects a client-only manifest into an eligible row', () => {
    expect(deviceEntries(state(manifest))).toMatchObject([{ hash, row: { name: 'device-board', running: true } }])
  })

  it('rejects a node half even when the cache host returned it', () => {
    expect(deviceEntries(state({ ...manifest, node: 'node.js' }))).toEqual([])
    expect(deviceEntries(state({ ...manifest, contributions: { frames: [], providers: [{ id: 'unsafe' }] } }))).toEqual([])
  })

  it('reads enablement from device preferences', () => {
    const stored = new Map([['acorn-pref:acorn-1:device_plugins_disabled', '["device-board"]']])
    vi.stubGlobal('localStorage', {
      get length() { return stored.size }, key: (index: number) => [...stored.keys()][index] ?? null,
      getItem: (key: string) => stored.get(key) ?? null,
    })
    expect(deviceEntries(state(manifest))[0]?.row).toMatchObject({ disabled: true, running: false })
  })
})
