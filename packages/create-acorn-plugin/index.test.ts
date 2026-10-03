import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { PLUGIN_API_MAJOR, speaksApiVersion } from '@acorn/protocol/plugin/apiVersion.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { parsePluginManifest } from '@acorn/node-core/server/plugins'
import { loadExternalPlugins, pluginInstallDir } from '@acorn/node-core/server/plugins'
// @ts-expect-error: the scaffold is published standalone with zero dependencies, so it's plain
// JavaScript with no declarations. This suite is the only thing in the repository that imports it.
import { API_VERSION, BASELINE, SCHEMA_URL, scaffoldFiles, toPluginId } from './index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES = join(HERE, '..')
const REPO = join(PACKAGES, '..')

// tsc and @types/node, resolved out of the workspace store so the out-of-repo check below needs no
// network. Both are pnpm-shaped paths, which is the one thing about this test that is not portable.
const CLI = join(HERE, 'index.mjs')

const documentedExample = (heading: string, language: string): string => {
  const source = readFileSync(join(REPO, 'docs/plugin-authoring/complete-example.md'), 'utf8')
  const marker = `## \`${heading}\``
  const section = source.indexOf(marker)
  const open = source.indexOf(`\`\`\`${language}\n`, section)
  const start = open + language.length + 4
  const end = source.indexOf('\n```', start)
  if (section < 0 || open < 0 || end < 0) throw new Error(`Could not find documented ${heading} example`)
  return `${source.slice(start, end)}\n`
}

function fencedExample(path: string, sectionTitle: string, language: string): string {
  const source = readFileSync(join(REPO, path), 'utf8')
  const section = source.indexOf(sectionTitle)
  const open = source.indexOf(`\`\`\`${language}\n`, section)
  const start = open + language.length + 4
  const end = source.indexOf('\n```', start)
  if (section < 0 || open < 0 || end < 0) throw new Error(`Could not find ${sectionTitle} in ${path}`)
  return source.slice(start, end)
}

/** Run the scaffolder the way a person does, in a fresh directory, and read back what it wrote. */
function runCli(...args: string[]): { dir: string; manifest: Record<string, unknown> } {
  const cwd = mkdtempSync(join(tmpdir(), 'acorn scaffold-'))
  execFileSync(process.execPath, [CLI, ...args], { cwd, stdio: 'pipe' })
  const [id] = readdirSync(cwd)
  const dir = join(cwd, id!)
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')) }
}

const TSC = join(PACKAGES, 'protocol', 'node_modules', '.bin', 'tsc')

function unpackPublishedPackage(name: string, destination: string): void {
  const output = execFileSync('pnpm', ['pack', '--pack-destination', dirname(destination)], {
    cwd: join(PACKAGES, name), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tarball = output.trim().split('\n').at(-1)
  if (!tarball?.endsWith('.tgz')) throw new Error(`pnpm pack did not return a tarball: ${output}`)
  mkdirSync(destination, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '--strip-components', '1', '-C', destination])
}
const NODE_TYPES = (() => {
  const store = join(REPO, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find((name) => name.startsWith('@types+node@'))
  if (!entry) throw new Error('@types/node is not in the pnpm store')
  return join(store, entry, 'node_modules')
})()

// The scaffold is a copy of the authoring contract living outside the repository's reach: nothing
// a reader of packages/protocol would think to grep finds it, and a stranger's first plugin is
// what breaks when it drifts. See docs/plugin-authoring/start-from-the-scaffold.md.

it('writes an api range this node accepts', () => {
  expect(API_VERSION).toBe(PLUGIN_API_MAJOR)
  expect(speaksApiVersion(API_VERSION)).toBe(true)
})

it('writes the baseline this node admits', () => {
  expect(BASELINE).toBe(ACORN_BASELINE)
})

it('points $schema at the schema this repository actually publishes', () => {
  // The other hardcoded copy, for the same reason as API_VERSION. A stale URL is worse than none: the
  // author's editor validates against a contract that is no longer the host's and says nothing.
  const generated = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../plugin-types/acorn-plugin.schema.json'), 'utf8'))
  expect(SCHEMA_URL).toBe(generated.$id)
})

it('keeps copyable manifest examples compatible with the host major', () => {
  for (const [path, section] of [
    ['docs/plugin-authoring/extensions.md', '## Add task annotations'],
    ['docs/plugin-authoring/complete-example.md', '## `acorn-plugin.json`'],
  ]) {
    const example = JSON.parse(fencedExample(path!, section!, 'json'))
    expect(speaksApiVersion(example.apiVersion), path).toBe(true)
    const result = parsePluginManifest(example)
    expect(result.ok ? null : result.reason, path).toBe(null)
  }
  const typesExample = JSON.parse(fencedExample('packages/plugin-types/README.md', '## The manifest schema', 'json'))
  expect(speaksApiVersion(typesExample.apiVersion)).toBe(true)
})

it('emits a manifest the host parses, cross-field rules and all', () => {
  const files = scaffoldFiles('my-widget') as Record<string, string>
  // The host's own parser, not the shape schema: the cross-field rules are what a scaffold trips,
  // such as an openPane naming a pane that isn't declared, or a route outside the plugin's namespace.
  const result = parsePluginManifest(JSON.parse(files['acorn-plugin.json']))
  expect(result.ok ? null : result.reason).toBe(null)
})

it('emits an owned tree pane that the command can open', () => {
  const files = scaffoldFiles('my-widget', 'My widget') as Record<string, string>
  const manifest = JSON.parse(files['acorn-plugin.json']) as { contributions: Record<string, unknown> }
  expect(manifest.contributions.frames).toEqual([{
    target: 'pane', id: 'my-widget', label: 'My widget', glyph: 'puzzle', order: 800,
    layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } },
  }])
  expect(manifest.contributions.commands).toEqual([{
    id: 'open', kind: 'action', title: 'Open My widget', category: 'pane',
    action: { verb: 'openPane', pane: 'my-widget' },
  }])
  expect(manifest.contributions.extensions).toBeUndefined()
  expect(files['client.js']).toContain("entries: ['pane']")
  expect(files['server/routes.js']).toContain("pathname !== '/greeting'")
})

it('emits a rectangle plugin under --rectangle, as a layout with a frame region', () => {
  // The other path: an iframe whose pixels are the author's. Same node half, same permissions, and a
  // `single` layout whose one region is the frame — the only way a surface asks for pixels now.
  const files = scaffoldFiles('my-widget', 'My widget', { rectangle: true }) as Record<string, string>
  const manifest = JSON.parse(files['acorn-plugin.json']) as { contributions: Record<string, unknown> }
  expect(manifest.contributions.extensions).toBeUndefined()
  expect(manifest.contributions.frames).toEqual([
    {
      target: 'pane', id: 'my-widget', label: 'My widget', glyph: 'puzzle', order: 800,
      layout: 'single', regions: { body: 'frame' },
    },
  ])
  expect(manifest.contributions.commands).toEqual([{
    id: 'open', kind: 'action', title: 'Open My widget', category: 'pane',
    action: { verb: 'openPane', pane: 'my-widget' },
  }])
  expect(parsePluginManifest(manifest).ok).toBe(true)
})

it('emits a node half that loads and satisfies the structural plugin check', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'scaffold-'))
  const dir = join(pluginInstallDir(dataRoot), 'my-widget')
  try {
    const files = scaffoldFiles('my-widget') as Record<string, string>
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }

    // What the loader does: import the entrypoint and check the default export structurally.
    const plugin = (await import(pathToFileURL(join(dir, 'node/index.js')).href)) as {
      default: { name: string; init: unknown }
    }
    expect(plugin.default.name).toBe('my-widget')
    expect(typeof plugin.default.init).toBe('function')

    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
    expect(failures).toEqual([])
    expect(loaded.map((entry) => entry.manifest.contributions.commands[0])).toMatchObject([{
      id: 'open', kind: 'action', title: 'Open My widget', category: 'pane',
      action: { verb: 'openPane', pane: 'my-widget' },
    }])
    await loaded[0]?.plugin.dispose?.()

    // The client behavior runs in scaffoldClient.test.ts. Keep syntax checks here for both variants.
    writeFileSync(join(dir, 'client.mjs'), files['client.js'])
    execFileSync(process.execPath, ['--check', join(dir, 'client.mjs')])
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

it('reloads an edited route module in a fresh isolated worker', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'scaffold-reload-'))
  const dir = join(pluginInstallDir(dataRoot), 'my-widget')
  const files = scaffoldFiles('my-widget') as Record<string, string>
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), contents)
  }
  const greeting = async () => {
    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
    expect(failures).toEqual([])
    const plugin = loaded[0]!.plugin
    let handle: ((request: Request, context: { userId: string }) => Promise<Response>) | undefined
    try {
      await plugin.init({
        log: { info: () => {} },
        routes: { fetch: (handler: typeof handle) => { handle = handler } },
        schedules: { register: () => {} },
        providers: {},
        events: {},
        core: { tasks: { load: async () => null } },
      } as never)
      const response = await handle!(new Request('https://node.invalid/greeting'), { userId: 'owner' })
      return await response.json() as { text: string }
    } finally {
      await plugin.dispose?.()
    }
  }
  try {
    expect((await greeting()).text).toBe('Hello from the node')
    writeFileSync(join(dir, 'server/routes.js'), files['server/routes.js']!.replace('Hello from the node', 'Hello after reload'))
    expect((await greeting()).text).toBe('Hello after reload')
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
}, 20_000)

it('refuses a name with no usable id in it', () => {
  expect(toPluginId('My Widget')).toBe('my-widget')
  expect(toPluginId('acorn.widget')).toBe('acorn-widget')
  // Leading digit, and nothing at all: both are ids the loader would reject, so the CLI says so
  // instead of writing a directory that can never install.
  expect(toPluginId('2fast')).toBe(null)
  expect(toPluginId('!!!')).toBe(null)
})

it('runs the packed scaffold and type-checks it against the packed declarations outside the repository', () => {
  // The acceptance test for `acorn-plugin-types`, and the only one that runs the way a stranger does:
  // a scaffolded directory somewhere else on disk, resolving the package by name out of its own
  // node_modules, with `checkJs` and `strict` on and library checking NOT skipped.
  //
  // Everything else about the types package is asserted from inside the workspace, where the
  // declarations resolve by path and the repo's own compiler options apply. Neither of those is true
  // for the person this package exists for. What this catches: a JSDoc annotation the scaffold writes
  // that names a type the package does not export, and a declaration file that needs something the
  // package never told anyone to install.
  const root = mkdtempSync(join(tmpdir(), 'scaffold-types-'))
  try {
    const cli = join(root, 'create-acorn-plugin')
    unpackPublishedPackage('create-acorn-plugin', cli)
    execFileSync(process.execPath, [join(cli, 'index.mjs'), 'my-widget'], { cwd: root })
    const dir = join(root, 'my-widget')
    const types = join(dir, 'node_modules', 'acorn-plugin-types')
    unpackPublishedPackage('plugin-types', types)
    expect(readFileSync(join(types, 'dist', 'index.d.ts'), 'utf8')).toContain('NodePluginContext')
    const declarations = readdirSync(join(types, 'dist', 'contracts'))
    expect(declarations.length).toBeGreaterThan(10)
    expect(declarations.every((name) => name.endsWith('.d.ts'))).toBe(true)
    expect(readdirSync(join(types, 'dist')).sort()).toEqual(['contracts', 'index.d.ts'])
    expect(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')).toContain('"apiVersion": "3"')

    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2023'],
        // The declared peer, and the reason it is declared: without it the package's own
        // `NodeJS.Signals` is an error in a file the author never wrote.
        types: ['node'],
        allowJs: true,
        checkJs: true,
        noEmit: true,
        strict: true,
        skipLibCheck: false,
      },
      include: ['node'],
    }))
    // Only @types/node comes from the workspace store. The two packages under test are tarball bytes.
    cpSync(NODE_TYPES, join(dir, 'node_modules'), { recursive: true, dereference: true })

    try {
      execFileSync(TSC, ['--noEmit'], { cwd: dir, stdio: 'pipe' })
      execFileSync(process.execPath, ['--check', join(dir, 'client.js')], { stdio: 'pipe' })
    } catch (error) {
      // tsc reports on stdout, so the default message ("Command failed") says nothing at all.
      throw new Error(String((error as { stdout?: Buffer }).stdout ?? error))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('imports and type-checks both packed client SDK exports outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-sdk-'))
  try {
    const sdk = join(root, 'node_modules', 'acorn-plugin-sdk')
    unpackPublishedPackage('plugin-sdk', sdk)
    // The remote entry imports Solid at runtime. Supply that declared peer from the local store;
    // the SDK itself still resolves only from bytes unpacked from its tarball.
    symlinkSync(realpathSync(join(PACKAGES, 'plugin-sdk', 'node_modules', 'solid-js')),
      join(root, 'node_modules', 'solid-js'), 'dir')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    const output = execFileSync(process.execPath, [
      '--input-type=module', '-e',
      "const [sdk, remote] = await Promise.all([import('acorn-plugin-sdk'), import('acorn-plugin-sdk/remote')]); console.log(typeof sdk.connect, typeof sdk.mountTree, typeof remote.solidTree, typeof remote.Card)",
    ], { cwd: root, encoding: 'utf8' })
    expect(output.trim()).toBe('function function function function')

    writeFileSync(join(root, 'consumer.ts'), [
      "import { mountTree, type AcornBridge } from 'acorn-plugin-sdk'",
      "import { Card, solidTree, type KitNodeProps } from 'acorn-plugin-sdk/remote'",
      'const props: KitNodeProps = { children: "Plugin content" }',
      'const pane = solidTree(({ bridge }: { bridge: AcornBridge }) => Card({ ...props, children: bridge.context.surface }))',
      'mountTree({ pane })',
    ].join('\n'))
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2023', 'DOM'],
        noEmit: true,
        strict: true,
        skipLibCheck: false,
      },
      include: ['consumer.ts'],
    }))
    try {
      execFileSync(TSC, ['--noEmit'], { cwd: root, stdio: 'pipe' })
    } catch (error) {
      throw new Error(String((error as { stdout?: Buffer; stderr?: Buffer }).stdout
        ?? (error as { stderr?: Buffer }).stderr
        ?? error))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)

it('type-checks the complete documented plugin example outside the workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'documented-plugin-'))
  try {
    const files = {
      'acorn-plugin.json': documentedExample('acorn-plugin.json', 'json'),
      'node/index.js': documentedExample('node/index.js', 'js'),
      'server/routes.js': documentedExample('server/routes.js', 'js'),
      'client.js': documentedExample('client.js', 'js'),
    }
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }

    const manifest = JSON.parse(files['acorn-plugin.json'])
    const parsed = parsePluginManifest(manifest)
    expect(parsed.ok ? null : parsed.reason).toBe(null)

    const types = join(dir, 'node_modules', 'acorn-plugin-types')
    unpackPublishedPackage('plugin-types', types)
    cpSync(NODE_TYPES, join(dir, 'node_modules'), { recursive: true, dereference: true })
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2023', 'DOM'],
        types: ['node'],
        allowJs: true,
        checkJs: true,
        noEmit: true,
        strict: true,
        skipLibCheck: false,
      },
      include: ['node', 'server'],
    }))

    try {
      execFileSync(TSC, ['--noEmit'], { cwd: dir, stdio: 'pipe' })
      execFileSync(process.execPath, ['--check', join(dir, 'client.js')], { stdio: 'pipe' })
    } catch (error) {
      throw new Error(String((error as { stdout?: Buffer; stderr?: Buffer }).stdout
        ?? (error as { stderr?: Buffer }).stderr
        ?? error))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 20_000)

// The one flag the CLI has, exercised through the CLI. Every other test here calls `scaffoldFiles`
// directly, which skips the argv reading entirely — so the flag could have stopped being read and
// nothing would have said so.
it('--rectangle picks the render path, wherever it sits in the argv', () => {
  const before = runCli('--rectangle', 'sink one')
  const after = runCli('sink two', '--rectangle')
  for (const { manifest } of [before, after]) {
    const frames = (manifest.contributions as { frames?: { regions?: Record<string, unknown> }[] }).frames ?? []
    // A rectangle: the host draws the box and the plugin draws the inside.
    expect(frames[0]?.regions).toEqual({ body: 'frame' })
  }
  // The name is read past the flag rather than as the flag, which is the mistake this guards.
  expect(before.dir.endsWith('sink-one')).toBe(true)
  expect(after.dir.endsWith('sink-two')).toBe(true)
})

it('scaffolds an owned tree pane by default', () => {
  const { manifest } = runCli('sink three')
  const contributions = manifest.contributions as { frames?: { regions?: Record<string, unknown> }[]; extensions?: unknown[] }
  expect(contributions.frames?.[0]?.regions).toEqual({ body: { kind: 'remote', entry: 'pane' } })
  expect(contributions.extensions).toBeUndefined()
})
