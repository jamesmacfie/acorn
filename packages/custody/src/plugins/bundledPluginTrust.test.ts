import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writePrivateAtomic } from '@acorn/node-core/server/storage'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/api.ts'
import { PluginCache } from './pluginCache'
import { PluginTrustStore } from './pluginTrustStore'
import { BUNDLED_TRUST_OPT_OUT, trustBundledClientPlugins, trustsBundledClientPlugins } from './bundledPluginTrust'

vi.mock('@acorn/node-core/server/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/node-core/server/storage')>()
  return { ...actual, writePrivateAtomic: vi.fn(actual.writePrivateAtomic) }
})

const roots: string[] = []
const temporary = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

const resourcePackage = (resources: string, id: string): string => {
  const dir = join(resources, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'client.js'), `export default '${id}'`)
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
    id, name: id, version: '1', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
    client: './client.js', permissions: { api: [], events: [], node: {} },
  }))
  return dir
}

afterEach(() => {
  vi.mocked(writePrivateAtomic).mockClear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('bundled plugin client trust', () => {
  it('commits a fresh roster once per metadata store, and only trust when app provenance changes', () => {
    const resources = temporary('acorn-bundled-trust-batch-')
    const userData = temporary('acorn-bundled-trust-user-')
    const ids = Array.from({ length: 7 }, (_, index) => `example-${index}`)
    for (const id of ids) resourcePackage(resources, id)
    const launch = (version: string) => trustBundledClientPlugins(resources, version,
      new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } }),
      new PluginTrustStore(userData))

    expect(launch('1')).toEqual(ids)
    expect(writePrivateAtomic).toHaveBeenCalledTimes(2)
    vi.mocked(writePrivateAtomic).mockClear()
    expect(launch('1')).toEqual(ids)
    expect(writePrivateAtomic).not.toHaveBeenCalled()
    expect(launch('2')).toEqual(ids)
    expect(writePrivateAtomic).toHaveBeenCalledTimes(1)
    expect(new PluginTrustStore(userData).list().map((ack) => ack.nodeId)).toEqual(ids.map(() => 'bundled:acorn-2'))
    expect(statSync(join(userData, 'acorn-1-plugin-cache/index.json')).mode & 0o777).toBe(0o600)
    expect(statSync(join(userData, 'acorn-1-plugin-trust.json')).mode & 0o777).toBe(0o600)
  })

  it('keeps valid siblings and unrelated rejected decisions when a resource is missing or malformed', () => {
    const resources = temporary('acorn-bundled-trust-partial-')
    const userData = temporary('acorn-bundled-trust-user-')
    resourcePackage(resources, 'first')
    rmSync(join(resourcePackage(resources, 'missing'), 'client.js'))
    const invalid = resourcePackage(resources, 'invalid')
    const malformed = JSON.parse(readFileSync(join(invalid, 'acorn-plugin.json'), 'utf8'))
    malformed.permissions.api = [123]
    writeFileSync(join(invalid, 'acorn-plugin.json'), JSON.stringify(malformed))
    resourcePackage(resources, 'last')
    const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
    const trust = new PluginTrustStore(userData)
    const firstHash = createHash('sha256').update("export default 'first'").digest('hex')
    // Application-resource acceptance continues to replace a rejection about those exact bytes.
    // A rejection about another bundle remains the owner's decision.
    const rejected = {
      pluginId: 'first', hash: firstHash, nodeId: 'node-a', version: '1',
      permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
      webviews: [], keyClaims: [], navigationDestinations: [], extensions: [], schedules: [], taskChecks: [],
      harnesses: [], agentTools: [], contextSections: [], customAgents: [], decision: 'rejected' as const, decidedAt: 100,
    }
    trust.record(rejected)
    trust.record({ ...rejected, pluginId: 'unrelated', hash: 'a'.repeat(64) })
    vi.mocked(writePrivateAtomic).mockClear()

    expect(trustBundledClientPlugins(resources, '1', cache, trust)).toEqual(['first', 'last'])
    expect(writePrivateAtomic).toHaveBeenCalledTimes(2)
    const persisted = new PluginTrustStore(userData)
    expect(persisted.decisionFor('first', firstHash)?.decision).toBe('accepted')
    expect(persisted.decisionFor('unrelated', 'a'.repeat(64))?.decision).toBe('rejected')
    expect(persisted.list()).toHaveLength(3)
    expect(Object.keys(new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } }).list())).toHaveLength(2)
  })

  it.each(['cache', 'trust'] as const)('retains retryable state when the %s commit fails', (failedStore) => {
    const resources = temporary('acorn-bundled-trust-failure-')
    const userData = temporary('acorn-bundled-trust-user-')
    resourcePackage(resources, 'example')
    const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
    const trust = new PluginTrustStore(userData)
    const hash = createHash('sha256').update("export default 'example'").digest('hex')
    if (failedStore === 'trust') {
      vi.mocked(writePrivateAtomic).mockImplementationOnce(vi.mocked(writePrivateAtomic).getMockImplementation()!)
    }
    vi.mocked(writePrivateAtomic).mockImplementationOnce(() => { throw new Error('disk unavailable') })

    expect(trustBundledClientPlugins(resources, '1', cache, trust)).toEqual([])
    expect(trust.list()).toEqual([])
    expect(new PluginTrustStore(userData).list()).toEqual([])
    expect(cache.has(hash)).toBe(failedStore === 'trust')
    expect(trustBundledClientPlugins(resources, '1', cache, trust)).toEqual(['example'])
    expect(new PluginTrustStore(userData).decisionFor('example', hash)?.decision).toBe('accepted')
  })

  it('caches and accepts the exact client bytes shipped in application resources', () => {
    const resources = temporary('acorn-bundled-trust-resources-')
    const userData = temporary('acorn-bundled-trust-user-')
    const plugin = join(resources, 'rollbar')
    mkdirSync(join(plugin, 'dist'), { recursive: true })
    const bytes = new TextEncoder().encode('export default function activate() {}\n')
    writeFileSync(join(plugin, 'dist/client.js'), bytes)
    writeFileSync(join(plugin, 'acorn-plugin.json'), JSON.stringify({
      id: 'rollbar', name: 'Rollbar', version: '1.2.3', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
      client: './dist/client.js',
      permissions: { api: ['core.tasks:read'], events: [], node: {} },
      contributions: {
        frames: [{
          target: 'pane', id: 'rollbar', label: 'Rollbar', glyph: 'circle-dot', order: 100,
          layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } },
        }],
        extensions: [{
          id: 'session-header', point: 'agents:session-header', label: 'Session cost', remote: 'pane',
        }],
      },
    }))
    const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
    const trust = new PluginTrustStore(userData)

    expect(trustBundledClientPlugins(resources, '1.0.0', cache, trust)).toEqual(['rollbar'])

    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(cache.has(hash)).toBe(true)
    expect(trust.decisionFor('rollbar', hash)).toMatchObject({
      pluginId: 'rollbar', version: '1.2.3', decision: 'accepted', nodeId: 'bundled:acorn-1.0.0',
      extensions: [{
        kind: 'extends', pointKind: 'remote', target: 'agents:session-header', label: 'Session cost',
      }],
    })
    expect(trust.decisionFor('rollbar', hash)?.partial).toBeUndefined()
  })

  // The whole second launch: sweep the cache, trust the bundled roster, and write nothing at all
  // because nothing changed.
  it('writes nothing under the plugin cache on a second launch with unchanged bundles', () => {
    const resources = temporary('acorn-bundled-trust-idempotent-')
    const userData = temporary('acorn-bundled-trust-user-')
    for (const id of ['rollbar', 'linear']) {
      const dir = join(resources, id)
      mkdirSync(join(dir, 'dist'), { recursive: true })
      writeFileSync(join(dir, 'dist/client.js'), `export default function activate() { return '${id}' }\n`)
      writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify({
        id, name: id, version: '1.2.3', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
        client: './dist/client.js',
        permissions: { api: [], events: [], node: {} },
      }))
    }
    const launch = (): string[] => {
      const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
      cache.sweep()
      const trust = new PluginTrustStore(userData)
      return trustBundledClientPlugins(resources, '1.0.0', cache, trust)
    }
    expect(launch()).toEqual(['linear', 'rollbar'])

    // Nanoseconds, so two writes inside one millisecond cannot compare equal.
    const stamps = (): Record<string, bigint> => {
      const out: Record<string, bigint> = {}
      for (const file of readdirSync(join(userData, 'acorn-1-plugin-cache'))) {
        out[file] = statSync(join(userData, 'acorn-1-plugin-cache', file), { bigint: true }).mtimeNs
      }
      out['acorn-1-plugin-trust.json'] = statSync(join(userData, 'acorn-1-plugin-trust.json'), { bigint: true }).mtimeNs
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
      id: 'linear', name: 'Wrong', version: '1', baseline: 'acorn-1', apiVersion: PLUGIN_API_MAJOR,
    }))

    const cache = new PluginCache(userData, { fetch: async () => { throw new Error('network must not be used') } })
    const trust = new PluginTrustStore(userData)
    expect(trustBundledClientPlugins(resources, '1.0.0', cache, trust)).toEqual([])
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
