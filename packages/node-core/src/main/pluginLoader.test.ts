import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR } from './pluginManifest'
import { installedPluginInfo, loadExternalPlugins, pluginInstallDir, readClientBundle } from './pluginLoader'
import { PluginMigrationsError } from './pluginMigrations'

// A minimal ESM node half. Written as source rather than bundled, because the loader's contract is
// "default-export something shaped like a NodePlugin from an ESM module" and nothing more.
const BUNDLE = (name: string) => `export default { name: ${JSON.stringify(name)}, init: () => {} }\n`
const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex')
const chain = (dir: string): string => {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
  return dir
}

let root = ''

const install = (dir: string, manifest: unknown, bundle?: string, client?: string): string => {
  const target = join(pluginInstallDir(root), dir)
  mkdirSync(join(target, 'dist'), { recursive: true })
  writeFileSync(join(target, 'acorn-plugin.json'), JSON.stringify(manifest))
  if (bundle !== undefined) writeFileSync(join(target, 'dist', 'node.js'), bundle)
  if (client !== undefined) writeFileSync(join(target, 'dist', 'client.js'), client)
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
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('the loader gate', () => {
  it('is silent and empty when there is no plugins directory at all', async () => {
    expect(await loadExternalPlugins(root, { builtins: [] })).toEqual({ loaded: [], installed: [], failures: [] })
    expect(console.warn).not.toHaveBeenCalled()
  })

  // The installer stages under `.staging-*` in this same directory, so a scan that treated every
  // subdirectory as a package would report a failure row for a download in flight.
  it('ignores dot-prefixed directories, which is where the installer stages', async () => {
    mkdirSync(join(pluginInstallDir(root), '.staging-abcd1234', 'unpacked'), { recursive: true })
    expect(await loadExternalPlugins(root, { builtins: [] })).toEqual({ loaded: [], installed: [], failures: [] })
  })

  // A `{ path }` dev install is a symlink, and Dirent.isDirectory() is lstat-shaped — it answers false
  // for one. Without the symlink branch the author's whole dogfood loop silently loads nothing.
  it('follows a symlinked package directory', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'acorn linked-'))
    mkdirSync(join(elsewhere, 'dist'), { recursive: true })
    writeFileSync(join(elsewhere, 'acorn-plugin.json'), JSON.stringify(manifest('ntfy')))
    writeFileSync(join(elsewhere, 'dist', 'node.js'), BUNDLE('ntfy'))
    mkdirSync(pluginInstallDir(root), { recursive: true })
    symlinkSync(elsewhere, join(pluginInstallDir(root), 'ntfy'))
    try {
      const { loaded } = await loadExternalPlugins(root, { builtins: [] })
      expect(loaded.map((entry) => entry.manifest.id)).toEqual(['ntfy'])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
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
    install('widget', manifest('widget', { node: undefined, client: './dist/client.js' }), undefined, 'export default {}')
    const { loaded, installed, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect({ loaded, failures }).toEqual({ loaded: [], failures: [] })
    // Nothing to run, but everything to distribute — which is why `installed` is a separate list.
    expect(installed.map((entry) => entry.manifest.id)).toEqual(['widget'])
  })

  it('marks a plugin that deliberately replaces a built-in', async () => {
    install('rollbar', manifest('rollbar'), BUNDLE('rollbar'))
    const { loaded } = await loadExternalPlugins(root, { builtins: ['rollbar', 'github'] })
    expect(loaded[0].shadowsBuiltin).toBe(true)
  })
})

describe('loaded-plugin migration ownership', () => {
  it('resolves a declared chain inside the plugin package', async () => {
    const dir = install('ntfy', manifest('ntfy', { migrations: './migrations' }), BUNDLE('ntfy'))
    const expected = chain(join(dir, 'migrations'))
    const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(failures).toEqual([])
    expect(loaded[0].migrationsFolder).toBe(expected)
  })

  it('fails a declaration that does not contain a migration chain', async () => {
    install('ntfy', manifest('ntfy', { migrations: './missing' }), BUNDLE('ntfy'))
    const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(loaded).toEqual([])
    expect(failures[0]?.reason).toMatch(/declares migrations.*no Drizzle migration chain/)
  })

  it('refuses storage without a declaration instead of adopting an ancestor decoy', async () => {
    chain(join(root, 'migrations'))
    install('ntfy', manifest('ntfy'), BUNDLE('ntfy'))
    const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(failures).toEqual([])
    expect(() => loaded[0].storage.open()).toThrow(PluginMigrationsError)
    expect(() => loaded[0].storage.open()).toThrow("Plugin 'ntfy' opened storage but declares no migrations")
  })
})

// What the node offers to devices (docs/plugins.md). The hash here is
// a claim the device cross-checks against the bytes it receives; it is never the thing trust binds to.
describe('the installed enumeration', () => {
  it('reports the client bundle hash and size', async () => {
    install('ntfy', manifest('ntfy', { client: './dist/client.js' }), BUNDLE('ntfy'), 'export default {}')
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    expect(installed[0].client).toEqual({ hash: sha256('export default {}'), bytes: 17 })
    expect(installedPluginInfo(installed[0])).toMatchObject({ id: 'ntfy', version: '1.0.0', apiVersion: PLUGIN_API_MAJOR })
    // The projection the route takes must not carry the node's filesystem layout.
    expect(installedPluginInfo(installed[0])).not.toHaveProperty('dir')
  })

  it('reports no bundle when the manifest declares none, or the file is not there', async () => {
    install('plain', manifest('plain'), BUNDLE('plain'))
    install('missing', manifest('missing', { client: './dist/client.js' }), BUNDLE('missing'))
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    expect(installed.map((entry) => [entry.manifest.id, entry.client])).toEqual([['missing', null], ['plain', null]])
  })

  it('reports no bundle for a client entrypoint that symlinks out of the plugin directory', async () => {
    // The manifest schema catches a literal `..`; this is the case only the symlink gate catches, and
    // it is the one that matters — a package can ship a link, not just a path.
    const outside = join(root, 'outside.js')
    writeFileSync(outside, 'export default {}')
    const dir = install('sneak', manifest('sneak', { client: './dist/client.js' }), BUNDLE('sneak'))
    symlinkSync(outside, join(dir, 'dist', 'client.js'))
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    expect(installed[0].client).toBeNull()
    expect(await readClientBundle(installed, 'sneak')).toBeNull()
  })

  it('leaves a package whose node half failed to import out of the enumeration entirely', async () => {
    // Broken, not client-only. Distributing its UI would put a row on every paired device for a plugin
    // whose routes exist nowhere.
    install('broken', manifest('broken', { client: './dist/client.js' }), 'nonsense(((\n', 'export default {}')
    const { installed, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(installed).toEqual([])
    expect(failures).toHaveLength(1)
  })

  it('re-reads and re-hashes the bytes it serves rather than trusting the boot hash', async () => {
    const dir = install('ntfy', manifest('ntfy', { client: './dist/client.js' }), BUNDLE('ntfy'), 'export default {}')
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    writeFileSync(join(dir, 'dist', 'client.js'), 'export default { changed: true }')
    const served = await readClientBundle(installed, 'ntfy')
    expect(new TextDecoder().decode(served!.bytes)).toBe('export default { changed: true }')
    // Deliberately disagrees with installed[0].client.hash: the device hashes what arrived, sees the
    // mismatch against the listing, and refuses. Fail closed.
    expect(served!.hash).toBe(sha256('export default { changed: true }'))
    expect(served!.hash).not.toBe(installed[0].client!.hash)
  })

  it('has nothing to serve for an unknown id or a package with no client half', async () => {
    install('plain', manifest('plain'), BUNDLE('plain'))
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    expect(await readClientBundle(installed, 'plain')).toBeNull()
    expect(await readClientBundle(installed, 'nope')).toBeNull()
  })
})

// The manifest is the only place a shell contribution can be declared, so what it parses is the whole
// vocabulary a third-party plugin's UI has (docs/plugins.md).
describe('declared frame contributions', () => {
  const withFrames = (frames: unknown[]) =>
    manifest('board', { client: './dist/client.js', contributions: { frames } })

  it('defaults a surface to a desktop pane at order 500', async () => {
    install('board', withFrames([{ target: 'pane', id: 'board', label: 'Board' }]), BUNDLE('board'), 'export default {}')
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    expect(installedPluginInfo(installed[0]).contributions.frames).toEqual([
      // `scope: 'task'` is part of the default set: a pane written before the field existed is a pane in a
      // task's layout, which is the only thing a pane has ever been.
      { target: 'pane', id: 'board', label: 'Board', glyph: 'puzzle', order: 500, scope: 'task', formFactor: ['desktop'], claimsKeys: [] },
    ])
  })

  it('has an empty list of every kind when the manifest declares no contributions at all', async () => {
    install('plain', manifest('plain'), BUNDLE('plain'))
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    // Present-and-empty rather than absent, so no adapter on the device has to distinguish "declared
    // none" from "did not know about this kind".
    expect(installedPluginInfo(installed[0]).contributions)
      .toEqual({ frames: [], sources: [], slots: [], palette: [], commands: [], keybindings: [], attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [], themes: [], contextMenus: [], extensionPoints: [], extensions: [] })
  })

  it('keeps keys it does not understand, so a manifest written for a newer acorn still loads', async () => {
    // Phase 4's declarative chrome lands under sibling keys. A strict object here would turn "this
    // acorn contributes less" into "this plugin does not parse".
    install('board', manifest('board', { contributions: { frames: [], descriptors: [{ kind: 'badge' }] } }), BUNDLE('board'))
    const { installed } = await loadExternalPlugins(root, { builtins: [] })
    expect(installed[0].manifest.contributions).toMatchObject({ descriptors: [{ kind: 'badge' }] })
  })

  it('skips a package whose surface declares an unknown target', async () => {
    install('board', withFrames([{ target: 'toolbar', id: 'board', label: 'Board' }]), BUNDLE('board'))
    const { installed, failures } = await loadExternalPlugins(root, { builtins: [] })
    expect(installed).toEqual([])
    expect(failures).toHaveLength(1)
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

  it('names the field a bad manifest broke, not just the schema', async () => {
    // The whole reason this reason exists. One collapsed sentence sent an author looking through ~30
    // rules by hand; the path is what tells them which line to open.
    const bad = manifest('board', { contributions: { frames: [{ target: 'toolbar', id: 'board', label: 'Board' }] } })
    install('board', bad, BUNDLE('board'))
    const reason = await reasonFor('board')
    expect(reason).toContain('contributions.frames[0]')
  })

  it('says a manifest is not JSON when it is not JSON', async () => {
    const target = join(pluginInstallDir(root), 'broken')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'acorn-plugin.json'), '{ "id": "broken",')
    expect(await reasonFor('broken')).toMatch(/not valid JSON/)
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

  it('rejects a migrations directory that symlinks outside the plugin package', async () => {
    const outside = chain(join(root, 'outside-migrations'))
    const dir = install('escape-migrations', manifest('escape-migrations', { migrations: './migrations' }), BUNDLE('escape-migrations'))
    symlinkSync(outside, join(dir, 'migrations'))
    expect(await reasonFor('escape-migrations')).toMatch(/resolves outside the plugin directory/)
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

// The half of the reload path that lives in this file: defeating Node's ES module cache, which is
// permanent and keyed on the resolved URL. Without this, "reload" would re-run the FIRST load's module
// object forever and every assertion about candidate-then-commit would be about nothing.
describe('re-importing a package for a reload', () => {
  const marked = (name: string, marker: string) =>
    `export default { name: ${JSON.stringify(name)}, init: () => {}, marker: ${JSON.stringify(marker)} }\n`
  const markerOf = async (options: Parameters<typeof loadExternalPlugins>[1]): Promise<string | undefined> => {
    const { loaded } = await loadExternalPlugins(root, options)
    return (loaded.find((entry) => entry.manifest.id === 'acme')?.plugin as { marker?: string } | undefined)?.marker
  }

  it('serves the cached module until a load names the id, then evaluates the file again', async () => {
    const dir = install('acme', manifest('acme'), marked('acme', 'v1'))
    expect(await markerOf({ builtins: [] })).toBe('v1')

    writeFileSync(join(dir, 'dist', 'node.js'), marked('acme', 'v2'))
    // Boot behaviour is deliberately unchanged: a second load with no `reimport` is the same module.
    expect(await markerOf({ builtins: [] })).toBe('v1')
    expect(await markerOf({ builtins: [], reimport: ['acme'] })).toBe('v2')
  })

  it('does NOT invalidate what the entry imports, which is the ceiling the docs state', async () => {
    const dir = install('acme', manifest('acme'), `import { marker } from './dep.js'\nexport default { name: 'acme', init: () => {}, marker }\n`)
    writeFileSync(join(dir, 'dist', 'dep.js'), `export const marker = 'dep-v1'\n`)
    expect(await markerOf({ builtins: [] })).toBe('dep-v1')

    // The generation stamp goes on the ENTRY's URL, and a relative specifier resolves against the URL's
    // path rather than inheriting its query — so the child comes back from the cache with the code it had
    // at boot. Pinned here so the limit cannot quietly change in either direction: a multi-file node half
    // needs a restart until a resolve hook stamps the whole subgraph.
    writeFileSync(join(dir, 'dist', 'dep.js'), `export const marker = 'dep-v2'\n`)
    expect(await markerOf({ builtins: [], reimport: ['acme'] })).toBe('dep-v1')
  })
})
