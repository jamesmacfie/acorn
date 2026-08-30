import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'
import { parsePluginManifest } from '@acorn/node-core/main/pluginManifest.ts'
// @ts-expect-error: the scaffold is published standalone with zero dependencies, so it's plain
// JavaScript with no declarations. This suite is the only thing in the repository that imports it.
import { API_VERSION, SCHEMA_URL, scaffoldFiles, toPluginId } from './index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES = join(HERE, '..')
const REPO = join(PACKAGES, '..')

// tsc and @types/node, resolved out of the workspace store so the out-of-repo check below needs no
// network. Both are pnpm-shaped paths, which is the one thing about this test that is not portable.
const CLI = join(HERE, 'index.mjs')

/** Run the scaffolder the way a person does, in a fresh directory, and read back what it wrote. */
function runCli(...args: string[]): { dir: string; manifest: Record<string, unknown> } {
  const cwd = mkdtempSync(join(tmpdir(), 'acorn scaffold-'))
  execFileSync(process.execPath, [CLI, ...args], { cwd, stdio: 'pipe' })
  const [id] = readdirSync(cwd)
  const dir = join(cwd, id!)
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')) }
}

const TSC = join(PACKAGES, 'protocol', 'node_modules', '.bin', 'tsc')
const NODE_TYPES = (() => {
  const store = join(REPO, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find((name) => /^@types\+node@/.test(name))
  if (!entry) throw new Error('@types/node is not in the pnpm store')
  return join(store, entry, 'node_modules')
})()

// The scaffold is a copy of the authoring contract living outside the repository's reach: nothing
// a reader of packages/protocol would think to grep finds it, and a stranger's first plugin is
// what breaks when it drifts. See docs/plugin-authoring.md § Start from the scaffold. These are
// the three ways it can drift silently.

it('writes the api major this node actually demands', () => {
  // The one number a manifest must match by exact string comparison. A `failed` roster row on every
  // scaffolded plugin is the failure mode this prevents.
  expect(API_VERSION).toBe(PLUGIN_API_MAJOR)
})

it('points $schema at the schema this repository actually publishes', () => {
  // The other hardcoded copy, for the same reason as API_VERSION. A stale URL is worse than none: the
  // author's editor validates against a contract that is no longer the host's and says nothing.
  const generated = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../plugin-types/acorn-plugin.schema.json'), 'utf8'))
  expect(SCHEMA_URL).toBe(generated.$id)
})

it('emits a manifest the host parses, cross-field rules and all', () => {
  const files = scaffoldFiles('my-widget') as Record<string, string>
  // The host's own parser, not the shape schema: the cross-field rules are what a scaffold trips,
  // such as an openPane naming a pane that isn't declared, or a route outside the plugin's namespace.
  const result = parsePluginManifest(JSON.parse(files['acorn-plugin.json']))
  expect(result.ok ? null : result.reason).toBe(null)
})

it('emits a tree plugin by default, filling a slot and an annotation point', () => {
  // The default render path since phase 9 of the layout programme, and both halves of the cooperative
  // seam: one contribution draws, the other only says something true (docs/plugins.md § The tree contract).
  const files = scaffoldFiles('my-widget', 'My widget') as Record<string, string>
  const manifest = JSON.parse(files['acorn-plugin.json']) as { contributions: Record<string, unknown> }
  expect(manifest.contributions.frames).toBeUndefined()
  expect(manifest.contributions.extensions).toEqual([
    {
      id: 'my-widget.tool-card',
      point: 'agents:tool-card',
      label: 'My widget tool calls',
      remote: 'toolCard',
      matches: ['execute'],
    },
    {
      id: 'my-widget.diff-note',
      point: 'changes:diff-line',
      label: 'My widget notes',
      items: '/v2/p/my-widget/marks',
    },
  ])
  // The entry the manifest names has to be one the bundle announces, or the host draws a placeholder
  // and the author's first run is a mystery. The annotation route has to exist for the same reason.
  expect(files['client.js']).toContain("entries: ['toolCard']")
  expect(files['node/routes.js']).toContain("pathname === '/marks'")
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
  expect(parsePluginManifest(manifest).ok).toBe(true)
})

it('emits a node half that loads and satisfies the structural plugin check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-'))
  try {
    const files = scaffoldFiles('my-widget') as Record<string, string>
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }

    // What the loader does: import the entrypoint and check the default export structurally. This also
    // proves the relative specifier between the two node files resolves with no node_modules in sight.
    const plugin = (await import(pathToFileURL(join(dir, 'node/index.js')).href)) as {
      default: { name: string; init: unknown }
    }
    expect(plugin.default.name).toBe('my-widget')
    expect(typeof plugin.default.init).toBe('function')

    // The client half can't be imported here: it reaches for `document` at module scope. Parse it
    // instead, since a syntax error in the generated bridge is otherwise a blank rectangle in
    // someone else's app.
    writeFileSync(join(dir, 'client.mjs'), files['client.js'])
    execFileSync(process.execPath, ['--check', join(dir, 'client.mjs')])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('refuses a name with no usable id in it', () => {
  expect(toPluginId('My Widget')).toBe('my-widget')
  expect(toPluginId('acorn.widget')).toBe('acorn-widget')
  // Leading digit, and nothing at all: both are ids the loader would reject, so the CLI says so
  // instead of writing a directory that can never install.
  expect(toPluginId('2fast')).toBe(null)
  expect(toPluginId('!!!')).toBe(null)
})

it("type-checks its node half against the published declarations, from outside this repository", () => {
  // The acceptance test for `acorn-plugin-types`, and the only one that runs the way a stranger does:
  // a scaffolded directory somewhere else on disk, resolving the package by name out of its own
  // node_modules, with `checkJs` and `strict` on and library checking NOT skipped.
  //
  // Everything else about the types package is asserted from inside the workspace, where the
  // declarations resolve by path and the repo's own compiler options apply. Neither of those is true
  // for the person this package exists for. What this catches: a JSDoc annotation the scaffold writes
  // that names a type the package does not export, and a declaration file that needs something the
  // package never told anyone to install.
  const dir = mkdtempSync(join(tmpdir(), 'scaffold-types-'))
  try {
    const files = scaffoldFiles('my-widget') as Record<string, string>
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }

    // The published artifact, not the source: `dist/index.d.ts` is what npm would deliver, and the
    // build that produces it is one `cp`.
    const types = join(dir, 'node_modules', 'acorn-plugin-types')
    mkdirSync(join(types, 'dist'), { recursive: true })
    copyFileSync(join(PACKAGES, 'plugin-types', 'src', 'public.ts'), join(types, 'dist', 'index.d.ts'))
    copyFileSync(join(PACKAGES, 'plugin-types', 'package.json'), join(types, 'package.json'))

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
    // Resolved out of the workspace store rather than installed, so this test needs no network. The
    // whole directory, dereferenced, because @types/node has a dependency of its own and a copy of the
    // symlink pnpm leaves behind would point outside the temp tree.
    cpSync(NODE_TYPES, join(dir, 'node_modules'), { recursive: true, dereference: true })

    try {
      execFileSync(TSC, ['--noEmit'], { cwd: dir, stdio: 'pipe' })
    } catch (error) {
      // tsc reports on stdout, so the default message ("Command failed") says nothing at all.
      throw new Error(String((error as { stdout?: Buffer }).stdout ?? error))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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

it('scaffolds a tree by default, with both halves of the cooperative seam', () => {
  const { manifest } = runCli('sink three')
  const contributions = manifest.contributions as { frames?: unknown[]; extensions?: { point: string }[] }
  // No rectangle at all: a tree plugin draws through somebody else's slot and its own pane comes later.
  expect(contributions.frames).toBeUndefined()
  expect((contributions.extensions ?? []).map((entry) => entry.point))
    .toEqual(['agents:tool-card', 'changes:diff-line'])
})
