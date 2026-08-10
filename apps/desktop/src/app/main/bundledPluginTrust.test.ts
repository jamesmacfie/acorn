import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'
import { PluginCache } from './pluginCache'
import { PluginTrustStore } from './pluginTrustStore'
import { trustBundledClientPlugins } from './bundledPluginTrust'

const roots: string[] = []
const temporary = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('bundled plugin client trust', () => {
  it('caches and accepts the exact client bytes shipped in application resources', () => {
    const resources = temporary('acorn-bundled-trust-resources-')
    const userData = temporary('acorn-bundled-trust-user-')
    const plugin = join(resources, 'rollbar')
    mkdirSync(join(plugin, 'dist'), { recursive: true })
    const bytes = new TextEncoder().encode('export default function activate() {}\n')
    writeFileSync(join(plugin, 'dist/client.js'), bytes)
    writeFileSync(join(plugin, 'acorn-plugin.json'), JSON.stringify({
      id: 'rollbar', name: 'Rollbar', version: '1.2.3', apiVersion: PLUGIN_API_MAJOR,
      client: './dist/client.js',
      permissions: { api: ['core.tasks:read'], events: [], node: {} },
      contributions: { frames: [{ target: 'pane', id: 'rollbar', label: 'Rollbar', glyph: 'circle-dot', order: 100 }] },
    }))
    const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
    const trust = new PluginTrustStore(userData)

    expect(trustBundledClientPlugins(resources, '0.1.0', cache, trust)).toEqual(['rollbar'])

    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(cache.has(hash)).toBe(true)
    expect(trust.decisionFor('rollbar', hash)).toMatchObject({
      pluginId: 'rollbar', version: '1.2.3', decision: 'accepted', nodeId: 'bundled:acorn-0.1.0',
    })
  })

  it('does not trust a malformed package or a directory with a mismatched id', () => {
    const resources = temporary('acorn-bundled-trust-invalid-')
    const userData = temporary('acorn-bundled-trust-user-')
    mkdirSync(join(resources, 'rollbar'), { recursive: true })
    writeFileSync(join(resources, 'rollbar/acorn-plugin.json'), JSON.stringify({
      id: 'linear', name: 'Wrong', version: '1', apiVersion: PLUGIN_API_MAJOR,
    }))

    const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
    const trust = new PluginTrustStore(userData)
    expect(trustBundledClientPlugins(resources, '0.1.0', cache, trust)).toEqual([])
    expect(trust.list()).toEqual([])
  })
})
