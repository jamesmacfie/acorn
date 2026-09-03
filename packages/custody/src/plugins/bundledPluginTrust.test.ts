import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'
import { PluginCache } from './pluginCache'
import { PluginTrustStore } from './pluginTrustStore'
import { BUNDLED_TRUST_OPT_OUT, trustBundledClientPlugins, trustsBundledClientPlugins } from './bundledPluginTrust'

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
      contributions: {
        frames: [{
          target: 'pane', id: 'rollbar', label: 'Rollbar', glyph: 'circle-dot', order: 100,
          layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } },
        }],
      },
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

  // The whole second launch, which is the shape the performance programme cared about: sweep the cache,
  // trust the bundled roster, and write nothing at all because nothing changed
  // (docs/performance.md § 2026-09-03 — phase 3).
  it('writes nothing under the plugin cache on a second launch with unchanged bundles', () => {
    const resources = temporary('acorn-bundled-trust-idempotent-')
    const userData = temporary('acorn-bundled-trust-user-')
    for (const id of ['rollbar', 'linear']) {
      const dir = join(resources, id)
      mkdirSync(join(dir, 'dist'), { recursive: true })
      writeFileSync(join(dir, 'dist/client.js'), `export default function activate() { return '${id}' }\n`)
      writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
        id, name: id, version: '1.2.3', apiVersion: PLUGIN_API_MAJOR,
        client: './dist/client.js',
        permissions: { api: [], events: [], node: {} },
      }))
    }
    const launch = (): string[] => {
      const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
      cache.sweep()
      const trust = new PluginTrustStore(userData)
      return trustBundledClientPlugins(resources, '0.1.0', cache, trust)
    }
    expect(launch()).toEqual(['linear', 'rollbar'])

    // Nanoseconds, so two writes inside one millisecond cannot compare equal.
    const stamps = (): Record<string, bigint> => {
      const out: Record<string, bigint> = {}
      for (const file of readdirSync(join(userData, 'plugin-cache'))) {
        out[file] = statSync(join(userData, 'plugin-cache', file), { bigint: true }).mtimeNs
      }
      out['plugin-trust.json'] = statSync(join(userData, 'plugin-trust.json'), { bigint: true }).mtimeNs
      return out
    }
    const before = stamps()
    expect(Object.keys(before).sort()).toHaveLength(4) // two bundles, the index, the trust file

    expect(launch()).toEqual(['linear', 'rollbar'])
    expect(stamps()).toEqual(before)
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

describe('when the grant applies', () => {
  // A development build gets the same grant a packaged build does, over the same application-owned
  // directory: gating it on packaging is what made every dev and e2e boot answer four dialogs about the
  // developer's own build output.
  it('applies whether or not the build is packaged', () => {
    expect(trustsBundledClientPlugins({})).toBe(true)
  })

  it('steps aside for anyone whose subject is the trust flow itself', () => {
    expect(trustsBundledClientPlugins({ [BUNDLED_TRUST_OPT_OUT]: '1' })).toBe(false)
    // Only the exact opt-in value, so a stray empty or "0" does not silently reintroduce four prompts.
    expect(trustsBundledClientPlugins({ [BUNDLED_TRUST_OPT_OUT]: '0' })).toBe(true)
    expect(trustsBundledClientPlugins({ [BUNDLED_TRUST_OPT_OUT]: '' })).toBe(true)
  })
})
