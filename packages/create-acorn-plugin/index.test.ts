import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { PLUGIN_API_MAJOR, speaksApiVersion } from '@acorn/protocol/plugin/apiVersion.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { parsePluginManifest } from '@acorn/node-core/server/plugins'
import { loadExternalPlugins, pluginInstallDir } from '@acorn/node-core/server/plugins'
import { copyNodeTypes, linkTool, run, TSC, unpackPublishedPackage } from '@acorn/plugin-examples/packed.ts'
import {
  API_VERSION,
  BASELINE,
  KNOWN_SOURCES,
  SCHEMA_URL,
  SDK_VERSION,
  scaffoldFiles,
  toInputName,
  toPluginId,
} from './index.mjs'

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
  const generated = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../plugin-types/acorn-plugin.schema.json'), 'utf8'),
  )
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
  // The types README names no major at all, so it can't go stale.
  const typesExample = JSON.parse(fencedExample('packages/plugin-types/README.md', '## The manifest schema', 'json'))
  expect(typesExample.apiVersion).toBeUndefined()
})

it("points the README at the running host's extension discovery and the tested example", () => {
  // The scaffold can't list points itself: they are registered in client code and change with the
  // host. So it names the three places that read them live, and the path the example test checks.
  const readme = (scaffoldFiles('my-widget') as Record<string, string>)['README.md']!
  expect(readme).toContain('`plugin_authoring` agent tool lists every point')
  expect(readme).toContain('**Settings → Advanced → Extension points**')
  expect(readme).toContain('`docs/plugin-authoring/extension-example.md`')
  expect(readFileSync(join(REPO, 'docs/plugin-authoring/extension-example.md'), 'utf8')).toContain(
    'examples/plugins/acme-review/',
  )
})

it("matches the tutorial's example, apart from the two files the tutorial edits", () => {
  // examples/plugins/hello-pane is what a reader of the public tutorial ends with, so every file the
  // tutorial doesn't touch has to be what the scaffold writes today.
  const files = scaffoldFiles('hello-pane') as Record<string, string>
  for (const [path, contents] of Object.entries(files)) {
    if (path === 'client.js' || path === 'server/routes.js') continue
    expect(readFileSync(join(REPO, 'examples/plugins/hello-pane', path), 'utf8'), path).toBe(contents)
  }
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
  expect(manifest.contributions.frames).toEqual([
    {
      target: 'pane',
      id: 'my-widget',
      label: 'My widget',
      glyph: 'puzzle',
      order: 800,
      layout: 'single',
      regions: { body: { kind: 'remote', entry: 'pane' } },
    },
  ])
  expect(manifest.contributions.commands).toEqual([
    {
      id: 'open',
      kind: 'action',
      title: 'Open My widget',
      category: 'pane',
      action: { verb: 'openPane', pane: 'my-widget' },
    },
  ])
  expect(manifest.contributions.extensions).toBeUndefined()
  expect(files['client.js']).toContain("entries: ['pane']")
  expect(files['server/routes.js']).toContain("pathname !== '/greeting'")
})

it('emits a rectangle plugin under --rectangle, as a layout with a frame region', () => {
  // The other path: an iframe whose pixels are the author's. Same node half, same permissions, and a
  // `single` layout whose one region is the frame, which is the only way a surface asks for pixels.
  const files = scaffoldFiles('my-widget', 'My widget', { rectangle: true }) as Record<string, string>
  const manifest = JSON.parse(files['acorn-plugin.json']) as { contributions: Record<string, unknown> }
  expect(manifest.contributions.extensions).toBeUndefined()
  expect(manifest.contributions.frames).toEqual([
    {
      target: 'pane',
      id: 'my-widget',
      label: 'My widget',
      glyph: 'puzzle',
      order: 800,
      layout: 'single',
      regions: { body: 'frame' },
    },
  ])
  expect(manifest.contributions.commands).toEqual([
    {
      id: 'open',
      kind: 'action',
      title: 'Open My widget',
      category: 'pane',
      action: { verb: 'openPane', pane: 'my-widget' },
    },
  ])
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
    expect(loaded.map((entry) => entry.manifest.contributions.commands[0])).toMatchObject([
      {
        id: 'open',
        kind: 'action',
        title: 'Open My widget',
        category: 'pane',
        action: { verb: 'openPane', pane: 'my-widget' },
      },
    ])
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
  type Principal = { kind: 'device' | 'internal'; userId: string; scope?: 'task'; taskId?: string }
  const greeting = async (path = '/greeting', principal: Principal = { kind: 'device', userId: 'owner' }) => {
    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
    expect(failures).toEqual([])
    const plugin = loaded[0]!.plugin
    let handle: ((request: Request, context: { userId: string; principal: Principal }) => Promise<Response>) | undefined
    try {
      await plugin.init({
        log: { info: () => {} },
        routes: {
          fetch: (handler: typeof handle) => {
            handle = handler
          },
        },
        schedules: { register: () => {} },
        providers: {},
        events: {},
        core: { tasks: { load: async () => null } },
      } as never)
      const response = await handle!(new Request(`https://node.invalid${path}`), { userId: 'owner', principal })
      const body = response.ok ? ((await response.json()) as { text: string }) : null
      return { status: response.status, text: body?.text }
    } finally {
      await plugin.dispose?.()
    }
  }
  try {
    expect((await greeting()).text).toBe('Hello from the node')
    // An agent's credential names one task, so the starter route won't load another one for it.
    const agent: Principal = { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task-1' }
    expect((await greeting('/greeting?taskId=task-2', agent)).status).toBe(404)
    expect((await greeting('/greeting?taskId=task-1', agent)).text).toBe('Hello from the node')
    writeFileSync(
      join(dir, 'server/routes.js'),
      files['server/routes.js']!.replace('Hello from the node', 'Hello after reload'),
    )
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
  // node_modules, with `checkJs` and `strict` on and library checking NOT skipped. It catches a JSDoc
  // annotation that names a type the package doesn't export, and a declaration file that needs
  // something the package never told anyone to install.
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
    expect(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')).toContain('"apiVersion": "6"')

    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
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
      }),
    )
    // Only @types/node comes from the workspace store. The two packages under test are tarball bytes.
    copyNodeTypes(join(dir, 'node_modules'))
    run(process.execPath, [TSC, '--noEmit'], dir)
    run(process.execPath, ['--check', join(dir, 'client.js')], dir)
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
    linkTool('solid-js', join(root, 'node_modules'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const [sdk, remote] = await Promise.all([import('acorn-plugin-sdk'), import('acorn-plugin-sdk/remote')]); console.log(typeof sdk.connect, typeof sdk.mountTree, typeof remote.solidTree, typeof remote.Card)",
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(output.trim()).toBe('function function function function')

    writeFileSync(
      join(root, 'consumer.ts'),
      [
        "import { mountTree, type AcornBridge } from 'acorn-plugin-sdk'",
        "import { Card, solidTree, type KitNodeProps } from 'acorn-plugin-sdk/remote'",
        'const props: KitNodeProps = { children: "Plugin content" }',
        'const pane = solidTree(({ bridge }: { bridge: AcornBridge }) => Card({ ...props, children: bridge.context.surface }))',
        'mountTree({ pane })',
      ].join('\n'),
    )
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
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
      }),
    )
    run(process.execPath, [TSC, '--noEmit'], root)
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
    copyNodeTypes(join(dir, 'node_modules'))
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
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
      }),
    )

    run(process.execPath, [TSC, '--noEmit'], dir)
    run(process.execPath, ['--check', join(dir, 'client.js')], dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 20_000)

// `--rectangle`, exercised through the CLI. The other tests call `scaffoldFiles` directly, which skips
// reading argv, so the flag could stop being read and nothing would say so.
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
  const contributions = manifest.contributions as {
    frames?: { regions?: Record<string, unknown> }[]
    extensions?: unknown[]
  }
  expect(contributions.frames?.[0]?.regions).toEqual({ body: { kind: 'remote', entry: 'pane' } })
  expect(contributions.extensions).toBeUndefined()
})

// ── --data-source ─────────────────────────────────────────────────────────────────────────────────

const readiness = {
  row: 'Issue',
  inputs: [{ source: 'linear:issues' }, { source: 'github:pull-requests', optional: true }],
}

it('lists the sources the SDK has field lists for, and depends on the SDK release that has them', () => {
  const lists = JSON.parse(readFileSync(join(PACKAGES, 'plugin-sdk/src/testing/sourceFields.json'), 'utf8')) as Record<
    string,
    { name: string; fields: { pointer: string; display?: { role?: string } }[] }
  >
  expect(KNOWN_SOURCES).toEqual(
    Object.entries(lists).map(([source, list]) => {
      const title = list.fields.find((field) => field.display?.role === 'title')?.pointer.slice(1)
      return { source, name: list.name, ...(title ? { title } : {}) }
    }),
  )
  expect(SDK_VERSION).toBe(JSON.parse(readFileSync(join(PACKAGES, 'plugin-sdk/package.json'), 'utf8')).version)
  expect(toInputName('github:pull-requests')).toBe('pullRequests')
  const taken = new Set<string>()
  expect([toInputName('core:local-branches', taken), toInputName('github:local-branches', taken)]).toEqual([
    'localBranches',
    'localBranches2',
  ])
})

it('emits a data source manifest the host parses, with the inputs it reads', () => {
  const files = scaffoldFiles('release-readiness', 'Release readiness', { dataSource: readiness }) as Record<
    string,
    string
  >
  const result = parsePluginManifest(JSON.parse(files['acorn-plugin.json']!))
  expect(result.ok ? null : result.reason).toBe(null)
  expect(JSON.parse(files['acorn-plugin.json']!).contributions.dataSources[0].inputs).toEqual({
    issues: { source: 'linear:issues', label: 'Linear issues' },
    pullRequests: { source: 'github:pull-requests', label: 'GitHub pull requests', optional: true },
  })
  expect(files['src/source.ts']).toContain('await inputs.pullRequests?.all()')
  // A typed answer lands in generated code, so anything that could break out of a string is refused.
  expect(() =>
    scaffoldFiles('x-y', 'X', { dataSource: { row: 'Row', inputs: [{ source: "a:b'); process.exit(1); ('" }] } }),
  ).toThrow("isn't a source id")
  expect(
    (
      scaffoldFiles('x-y', "Bob's view", {
        dataSource: { row: "Bob's row", inputs: [{ source: 'acme:deploys' }] },
      }) as Record<string, string>
    )['src/source.ts'],
  ).toContain("name: 'Bob\\'s view'")
})

it('builds, tests, and loads a data source package from the packed SDK outside the repository', async () => {
  // The acceptance test for `--data-source`: the generated package passes its own test against the
  // packed SDK, builds, writes the manifest entry the scaffold already wrote, and loads.
  const root = mkdtempSync(join(tmpdir(), 'scaffold-data-'))
  try {
    const files = scaffoldFiles('release-readiness', 'Release readiness', { dataSource: readiness }) as Record<
      string,
      string
    >
    const dir = join(root, 'release-readiness')
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }
    unpackPublishedPackage('plugin-sdk', join(dir, 'node_modules', 'acorn-plugin-sdk'))
    unpackPublishedPackage('plugin-types', join(dir, 'node_modules', 'acorn-plugin-types'))
    // The build tools come from the workspace store. The two packages under test are tarball bytes.
    for (const tool of ['vite', 'vitest']) linkTool(tool, join(dir, 'node_modules'))
    const node = (...args: string[]) => run(process.execPath, args, dir)
    expect(node('node_modules/vitest/vitest.mjs', 'run')).toMatch(/1 passed/)
    // The typed handles are the point of the SDK, so the starter has to compile against the packed
    // declarations, the optional input's `?.` included.
    node(TSC, '--noEmit')
    node('node_modules/vite/bin/vite.js', 'build')
    node('scripts/manifest.mjs')
    expect(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')).toBe(files['acorn-plugin.json'])
    // The bundle has to stand alone: an installed plugin has no node_modules beside it.
    expect(readFileSync(join(dir, 'dist/node.js'), 'utf8')).not.toMatch(/from ['"]acorn-plugin-sdk/)

    const dataRoot = join(root, 'data')
    const installed = join(pluginInstallDir(dataRoot), 'release-readiness')
    mkdirSync(installed, { recursive: true })
    cpSync(join(dir, 'acorn-plugin.json'), join(installed, 'acorn-plugin.json'))
    cpSync(join(dir, 'dist'), join(installed, 'dist'), { recursive: true })
    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
    expect(failures).toEqual([])
    expect(loaded[0]?.manifest.contributions.dataSources?.[0]?.inputs).toMatchObject({
      issues: { source: 'linear:issues' },
    })
    await loaded[0]?.plugin.dispose?.()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 120_000)

it('asks what a row is and what it reads under --data-source', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'acorn scaffold-'))
  // The prompt lists KNOWN_SOURCES numbered from 1, so pick by position rather than a fixed number.
  const pick = (source: string) => KNOWN_SOURCES.findIndex((known) => known.source === source) + 1
  try {
    execFileSync(process.execPath, [CLI, 'readiness', '--data-source'], {
      cwd,
      input: `Issue\n${pick('linear:issues')}, ${pick('github:pull-requests')}\n${pick('github:pull-requests')}\n`,
      stdio: 'pipe',
    })
    const manifest = JSON.parse(readFileSync(join(cwd, 'readiness', 'acorn-plugin.json'), 'utf8'))
    expect(manifest.contributions.dataSources[0]).toMatchObject({
      singular: 'Issue',
      plural: 'Issues',
      inputs: {
        issues: { source: 'linear:issues' },
        pullRequests: { source: 'github:pull-requests', optional: true },
      },
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

// ── --trigger ─────────────────────────────────────────────────────────────────────────────────────

it('emits a trigger manifest the host parses, with a feed, a command, and a suggested trigger', () => {
  const files = scaffoldFiles('my-alerts', 'My alerts', { trigger: true }) as Record<string, string>
  const result = parsePluginManifest(JSON.parse(files['acorn-plugin.json']!))
  expect(result.ok ? null : result.reason).toBe(null)
  const { dataSources, cliCommands } = JSON.parse(files['acorn-plugin.json']!).contributions
  expect(dataSources[0]).toMatchObject({ sourceId: 'alerts', feed: { starterTriggers: [{ id: 'critical' }] } })
  expect(cliCommands.map((command: { name: string }) => command.name)).toEqual(['raise'])
  expect(Object.keys(files)).toEqual(expect.arrayContaining(['src/feed.ts', 'src/index.ts', 'src/feed.test.ts']))
})

it('builds, tests, and loads a trigger package from the packed SDK outside the repository', async () => {
  // The acceptance test for `--trigger`: the generated package passes its own test against the packed
  // SDK, type-checks, builds, writes the feed entry the scaffold already wrote, and loads.
  const root = mkdtempSync(join(tmpdir(), 'scaffold-trigger-'))
  try {
    const files = scaffoldFiles('my-alerts', 'My alerts', { trigger: true }) as Record<string, string>
    const dir = join(root, 'my-alerts')
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }
    unpackPublishedPackage('plugin-sdk', join(dir, 'node_modules', 'acorn-plugin-sdk'))
    unpackPublishedPackage('plugin-types', join(dir, 'node_modules', 'acorn-plugin-types'))
    copyNodeTypes(join(dir, 'node_modules'))
    for (const tool of ['vite', 'vitest']) linkTool(tool, join(dir, 'node_modules'))
    const node = (...args: string[]) => run(process.execPath, args, dir)
    expect(node('node_modules/vitest/vitest.mjs', 'run')).toMatch(/2 passed/)
    node(TSC, '--noEmit')
    node('node_modules/vite/bin/vite.js', 'build')
    node('scripts/manifest.mjs')
    expect(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')).toBe(files['acorn-plugin.json'])
    expect(readFileSync(join(dir, 'dist/node.js'), 'utf8')).not.toMatch(/from ['"]acorn-plugin-sdk/)

    const dataRoot = join(root, 'data')
    const installed = join(pluginInstallDir(dataRoot), 'my-alerts')
    mkdirSync(installed, { recursive: true })
    cpSync(join(dir, 'acorn-plugin.json'), join(installed, 'acorn-plugin.json'))
    cpSync(join(dir, 'dist'), join(installed, 'dist'), { recursive: true })
    const { loaded, failures } = await loadExternalPlugins(dataRoot, { builtins: [] })
    expect(failures).toEqual([])
    expect(loaded[0]?.manifest.contributions.dataSources?.[0]).toMatchObject({ sourceId: 'alerts' })
    await loaded[0]?.plugin.dispose?.()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 120_000)

it('writes the trigger template under --trigger', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'acorn scaffold-'))
  try {
    execFileSync(process.execPath, [CLI, 'my-alerts', '--trigger'], { cwd, stdio: 'pipe' })
    expect(readdirSync(join(cwd, 'my-alerts', 'src')).sort()).toEqual(['feed.test.ts', 'feed.ts', 'index.ts'])
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
