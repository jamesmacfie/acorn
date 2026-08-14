import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLUGIN_CONFIG_FILE, validatePluginConfig } from './manifest'

// A temp plugin package: a directory named for the plugin id (which is where the id comes from), a
// package.json for the version, and the config under test.
let dir = ''
const pkg = (id: string, config: string): string => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-config-'))
  const root = join(dir, id)
  mkdirSync(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `@acorn/plugin-${id}`, version: '1.2.3' }))
  writeFileSync(join(root, PLUGIN_CONFIG_FILE), config)
  return root
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('validatePluginConfig', () => {
  it('accepts a minimal config and fills the manifest the builder would stamp', async () => {
    const root = pkg('probe', `export default { name: 'Probe', entry: 'x', factory: 'x', permissions: {}, contributions: {} }\n`)
    const result = await validatePluginConfig(root)
    expect(result.ok ? result.manifest.id : result.reason).toBe('probe')
    if (!result.ok) throw new Error(result.reason)
    expect(result.manifest.version).toBe('1.2.3')
    expect(result.manifest.node).toBe('./dist/node.js')
  })

  it('names the field and the path when a contribution is wrong', async () => {
    // A frame declaring a surface the schema does not know. Today this is found by running the builder,
    // or by a boot-time console line in a packaged app that shows it to nobody.
    const root = pkg('probe', `export default {
      name: 'Probe',
      contributions: { frames: [{ target: 'nowhere', id: 'f', label: 'F' }] },
    }\n`)
    const result = await validatePluginConfig(root)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(PLUGIN_CONFIG_FILE)
    expect(result.reason).toContain('contributions.frames[0].target')
  })

  it('catches a route a plugin does not own, which is the rule nobody can check by eye', async () => {
    // The cross-field refinement: a client route may address this plugin's own `/v2/p/<id>/` prefix and
    // nothing else. Getting it wrong is a package that installs and then cannot open its own surface.
    const root = pkg('probe', `export default {
      name: 'Probe',
      contributions: { sources: [{ id: 's', label: 'S', glyph: 'list', order: 10, items: '/v2/p/github/rail-items' }] },
    }\n`)
    const result = await validatePluginConfig(root)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/\/v2\/p\/probe\//)
  })

  it('reports a config it cannot even import, rather than throwing', async () => {
    const root = pkg('probe', 'export default {\n')
    const result = await validatePluginConfig(root)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('could not be imported')
  })

  it('reports a missing config file', async () => {
    const result = await validatePluginConfig(join(tmpdir(), 'acorn-config-absent'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('does not exist')
  })
})
