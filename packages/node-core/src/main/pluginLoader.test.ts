import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR } from './pluginManifest'
import { loadExternalPlugins, pluginInstallDir, UNSAFE_FLAG } from './pluginLoader'

// A minimal ESM node half. Written as source rather than bundled, because the loader's contract is
// "default-export something shaped like a NodePlugin from an ESM module" and nothing more.
const BUNDLE = (name: string) => `export default { name: ${JSON.stringify(name)}, init: () => {} }\n`

let root = ''

const install = (dir: string, manifest: unknown, bundle?: string): string => {
  const target = join(pluginInstallDir(root), dir)
  mkdirSync(join(target, 'dist'), { recursive: true })
  writeFileSync(join(target, 'acorn-plugin.json'), JSON.stringify(manifest))
  if (bundle !== undefined) writeFileSync(join(target, 'dist', 'node.js'), bundle)
  return target
}

const manifest = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `${id} plugin`,
  version: '1.0.0',
  apiVersion: PLUGIN_API_MAJOR,
  node: './dist/node.js',
  ...over,
})

beforeEach(() => {
  // A path with a SPACE on purpose: the loader must reach the bundle through pathToFileURL, and a
  // bare `import('/a b/c.js')` fails on exactly this input (and on every Windows path).
  root = mkdtempSync(join(tmpdir(), 'acorn loader-'))
  vi.stubEnv(UNSAFE_FLAG, '1')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('the loader gate', () => {
  it('loads nothing without the unsafe flag, and says so when something is installed', async () => {
    vi.stubEnv(UNSAFE_FLAG, '')
    install('ntfy', manifest('ntfy'), BUNDLE('ntfy'))
    const result = await loadExternalPlugins(root, { builtins: [] })
    expect(result).toEqual({ loaded: [], failures: [] })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(UNSAFE_FLAG))
  })

  it('is silent and empty when there is no plugins directory at all', async () => {
    expect(await loadExternalPlugins(root, { builtins: [] })).toEqual({ loaded: [], failures: [] })
    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('loading a plugin', () => {
  it('imports the node half through a path containing spaces', async () => {
    install('ntfy', manifest('ntfy'), BUNDLE('ntfy'))
    const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(failures).toEqual([])
    expect(loaded).toHaveLength(1)
    expect(loaded[0].plugin.name).toBe('ntfy')
    expect(loaded[0].manifest.permissions.node.core).toEqual([])
    expect(loaded[0].shadowsBuiltin).toBe(false)
  })

  it('carries the declared node permissions through untouched', async () => {
    install('ntfy', manifest('ntfy', { permissions: { node: { core: ['projects:read'], secrets: true } } }), BUNDLE('ntfy'))
    const { loaded } = await loadExternalPlugins(root, { builtins: [] })
    expect(loaded[0].manifest.permissions.node).toMatchObject({ core: ['projects:read'], secrets: true, exec: false })
  })

  it('takes a client-only package without complaint and loads nothing for it', async () => {
    install('widget', manifest('widget', { node: undefined, client: './dist/client.js' }))
    expect(await loadExternalPlugins(root, { builtins: [] })).toEqual({ loaded: [], failures: [] })
  })

  it('marks a plugin that deliberately replaces a built-in', async () => {
    install('rollbar', manifest('rollbar'), BUNDLE('rollbar'))
    const { loaded } = await loadExternalPlugins(root, { builtins: ['rollbar', 'github'] })
    expect(loaded[0].shadowsBuiltin).toBe(true)
  })
})

// Every case here is a SKIP plus a report. The loader must never throw: one broken installed plugin
// cannot be allowed to stop a node from booting.
describe('rejections', () => {
  const reasonFor = async (dir: string, builtins: readonly string[] = []) => {
    const { loaded, failures } = await loadExternalPlugins(root, { builtins })
    expect(loaded.map((entry) => entry.manifest.id)).not.toContain(dir)
    return failures.find((failure) => failure.dir.endsWith(dir))?.reason ?? ''
  }

  it('rejects a missing manifest', async () => {
    mkdirSync(join(pluginInstallDir(root), 'empty'), { recursive: true })
    expect(await reasonFor('empty')).toMatch(/manifest schema|missing/)
  })

  it('rejects an id that is not a legal route namespace or filename', async () => {
    install('bad', manifest('Not An Id'), BUNDLE('Not An Id'))
    expect(await reasonFor('bad')).toMatch(/manifest schema/)
  })

  it('rejects a manifest built for another plugin API major', async () => {
    install('future', manifest('future', { apiVersion: '99' }), BUNDLE('future'))
    expect(await reasonFor('future')).toMatch(/plugin API 99/)
  })

  it('rejects a second directory claiming an already-loaded id', async () => {
    install('one', manifest('ntfy'), BUNDLE('ntfy'))
    install('two', manifest('ntfy'), BUNDLE('ntfy'))
    const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(loaded).toHaveLength(1)
    expect(failures[0].reason).toMatch(/already claims the id/)
  })

  it('rejects an entrypoint that escapes the plugin directory', async () => {
    // The manifest schema catches the literal `..`; a symlink out would be caught by resolveInRoot.
    install('escape', manifest('escape', { node: '../../elsewhere.js' }), BUNDLE('escape'))
    expect(await reasonFor('escape')).toMatch(/manifest schema/)
  })

  it('rejects a bundle that cannot be imported', async () => {
    install('broken', manifest('broken'), 'this is not javascript at all(((\n')
    expect(await reasonFor('broken')).toMatch(/could not import/)
  })

  it('rejects a bundle with no default export', async () => {
    install('named', manifest('named'), 'export const plugin = { name: "named", init: () => {} }\n')
    expect(await reasonFor('named')).toMatch(/default-export/)
  })

  it('rejects a default export that is not shaped like a NodePlugin', async () => {
    install('shapeless', manifest('shapeless'), 'export default { name: "shapeless" }\n')
    expect(await reasonFor('shapeless')).toMatch(/default-export/)
  })

  it('rejects a bundle whose name disagrees with the manifest id', async () => {
    install('liar', manifest('liar'), BUNDLE('github'))
    expect(await reasonFor('liar')).toMatch(/but the manifest id is/)
  })

  it('keeps loading the healthy siblings of a broken plugin', async () => {
    install('broken', manifest('broken'), 'nonsense(((\n')
    install('fine', manifest('fine'), BUNDLE('fine'))
    const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(loaded.map((entry) => entry.manifest.id)).toEqual(['fine'])
    expect(failures).toHaveLength(1)
  })
})
