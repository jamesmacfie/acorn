import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Architecture boundary enforcement. Every rule below is stated, with the failure it prevents, in
// docs/architecture-overview.md § Package boundaries. Read that first, then this for the mechanics.
//
// The scanner resolves relative and bare @acorn/* specifiers, so the package graph is checked across
// intra-package and cross-package imports alike. Test files follow the same rules as production files
// unless a rule names an exception.

const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css']

type Pkg = { name: string; dir: string; src: string; kind: 'app' | 'plugin' | 'lib' }

// Derived from the filesystem, never hardcoded: a new package is covered the day it is added.
const PACKAGES: Pkg[] = ['apps', 'packages', 'plugins', 'tools']
  .flatMap((base) => {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'package.json')))
      .map((e) => join(dir, e.name))
  })
  .map((dir) => {
    const name = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string }).name
    // Kind comes from where a package lives, not its name (docs/architecture-overview.md § Package
    // boundaries): the `@acorn/plugin-` name prefix would classify `@acorn/plugin-api`, a shared
    // library every plugin imports, as a plugin.
    const base = basename(dirname(dir))
    const kind: Pkg['kind'] = base === 'apps' ? 'app' : base === 'plugins' ? 'plugin' : 'lib'
    return { name, dir, src: join(dir, 'src'), kind }
  })

const byName = new Map(PACKAGES.map((p) => [p.name, p]))
const pkgOf = (file: string): Pkg | undefined => PACKAGES.find((p) => file.startsWith(p.dir + '/'))

// Every import form, including side-effect `import '…'` and the vi.mock family: a mock path is a real
// dependency edge, and missing them is how the database -> editor edge went undeclared.
//
// It does not strip comments, and that is a sharp edge: a comment containing an import call becomes a
// phantom edge and fails the resolver rule below. Stripping would mean parsing, and missing a real edge
// hidden after a `//` is the worse failure. Describe a moved import in prose, not in a form that parses.
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*)(['"])([^'"\n]+)\1/g

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function resolveFile(abs: string): string | null {
  if (existsSync(abs) && statSync(abs).isFile()) return abs
  for (const ext of EXTS) if (existsSync(abs + ext)) return abs + ext
  for (const ext of EXTS) {
    const i = join(abs, 'index' + ext)
    if (existsSync(i)) return i
  }
  return null
}

/** A resolved edge target: a first-party file, a bare external, or unresolvable. */
type Target = { file: string | null; external: string | null; pkg: Pkg | undefined }

function resolveSpec(from: string, spec: string): Target {
  // Vite import queries pick a loader, not a filesystem path. Keep the original specifier for
  // diagnostics but resolve the underlying module, so `?raw` and `?url` stay covered.
  const fileSpec = spec.split(/[?#]/, 1)[0]
  if (fileSpec.startsWith('.')) {
    const file = resolveFile(resolve(dirname(from), fileSpec))
    return { file, external: null, pkg: file ? pkgOf(file) : undefined }
  }
  if (fileSpec.startsWith('@acorn/')) {
    const [scope, name, ...rest] = fileSpec.split('/')
    const pkg = byName.get(`${scope}/${name}`)
    if (!pkg) return { file: null, external: null, pkg: undefined }
    const file = resolveFile(join(pkg.src, rest.join('/')))
    return { file, external: null, pkg }
  }
  return { file: null, external: spec.split('/')[0].startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0], pkg: undefined }
}

type Edge = { fromFile: string; fromPkg: Pkg; spec: string; target: Target; isTest: boolean }

const EDGES: Edge[] = PACKAGES.flatMap((p) =>
  walk(p.src).concat(walk(join(p.dir, 'test')), walk(join(p.dir, 'scripts'))).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const out: Edge[] = []
    let m: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(text))) {
      out.push({ fromFile: file, fromPkg: p, spec: m[2], target: resolveSpec(file, m[2]), isTest: /\.test\.tsx?$/.test(file) })
    }
    return out
  }),
)

const rel = (f: string) => relative(ROOT, f)
const firstParty = EDGES.filter((e) => e.target.pkg)
const crossPackage = firstParty.filter((e) => e.target.pkg!.name !== e.fromPkg.name)

// The first path segment of a file inside its package's src/: 'client', 'server', 'main', 'contract',
// 'shared', and so on.
const segment = (pkg: Pkg, file: string): string => relative(pkg.src, file).split('/')[0]

// contract/ is the one cross-plugin import surface (docs/plugins.md § Package shape). A plugin may
// import another plugin's contract/; anything else is a coupling edge.
const isContract = (pkg: Pkg | undefined, file: string | null): boolean =>
  !!pkg && !!file && pkg.kind === 'plugin' && segment(pkg, file) === 'contract'

// Test scaffolding by location, not filename: a `.test.ts` suffix, a package's test/ or e2e/ tree, or
// its testkit/, whose helpers are test-only but deliberately unsuffixed.
const isTestCode = (file: string): boolean => /\.test\.tsx?$/.test(file) || /\/(test|e2e|testkit)\//.test(rel(file))

// Which side of the client/node split a file sits on, from its path inside its package.
function side(pkg: Pkg, file: string): 'client' | 'node' | 'shared' {
  if (pkg.name === '@acorn/client-core') return 'client'
  if (pkg.name === '@acorn/node-core') return 'node'
  if (pkg.name === '@acorn/protocol') return 'shared'
  // The facade carries both halves, so it's classified per entrypoint. Otherwise `node/` falls through
  // to 'shared' and a renderer importing @acorn/plugin-api/node drags node code into the bundle with no
  // rule firing. `testkit` counts as node; `testkit/client.ts` is the client seam and counts as client.
  if (pkg.name === '@acorn/plugin-api') {
    const seg = segment(pkg, file)
    if (seg === 'testkit') return file.endsWith('/client.ts') ? 'client' : 'node'
    return seg === 'node' ? 'node' : 'client'
  }
  const seg = relative(pkg.src, file).split('/')[0]
  if (seg === 'client') return 'client'
  if (seg === 'server' || seg === 'main' || seg === 'service' || seg === 'mcp' || seg === 'wiring') return 'node'
  return 'shared'
}

describe('architecture boundaries', () => {
  // Anti-vacuity for the suite: every assertion below is "expect empty", which a broken resolver would
  // satisfy trivially.
  it('sees a non-trivial package graph (anti-vacuity)', () => {
    expect(PACKAGES.length).toBeGreaterThanOrEqual(20)
    expect(EDGES.length).toBeGreaterThan(2000)
    expect(crossPackage.length).toBeGreaterThan(500)
    expect(crossPackage.some((e) => e.spec.startsWith('@acorn/'))).toBe(true)
  })

  it('every first-party specifier resolves to a real file', () => {
    const broken = EDGES.filter((e) => e.spec.startsWith('@acorn/') && !e.target.file).map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    expect([...new Set(broken)].sort()).toEqual([])
  })

  it('no relative import escapes its own package', () => {
    const escapes = firstParty
      .filter((e) => e.spec.startsWith('.') && e.target.pkg!.name !== e.fromPkg.name)
      .map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    expect([...new Set(escapes)].sort()).toEqual([])
  })

  it('every @acorn dependency is declared in package.json', () => {
    const undeclared: string[] = []
    for (const p of PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})])
      for (const e of crossPackage.filter((x) => x.fromPkg.name === p.name)) {
        if (!declared.has(e.target.pkg!.name)) undeclared.push(`${p.name} -> ${e.target.pkg!.name}`)
      }
    }
    expect([...new Set(undeclared)].sort()).toEqual([])
  })

  it('nothing imports an app (composition roots are leaves)', () => {
    const into = crossPackage
      .filter((e) => e.target.pkg!.kind === 'app' && e.fromPkg.kind !== 'app')
      .map((e) => `${e.fromPkg.name} -> ${e.target.pkg!.name}`)
    expect([...new Set(into)].sort()).toEqual([])
  })

  it('shared libraries never import a plugin', () => {
    // Acyclicity alone doesn't catch this: a plugin whose only upstream is @acorn/protocol closes no
    // cycle.
    const inverted = crossPackage
      .filter((e) => e.fromPkg.kind === 'lib' && e.target.pkg!.kind === 'plugin')
      .map((e) => `${e.fromPkg.name} -> ${e.target.pkg!.name}`)
    expect([...new Set(inverted)].sort()).toEqual([])
  })

  it('apps never import each other', () => {
    const appToApp = crossPackage
      .filter((e) => e.fromPkg.kind === 'app' && e.target.pkg!.kind === 'app')
      .map((e) => `${e.fromPkg.name} -> ${e.target.pkg!.name}`)
    expect([...new Set(appToApp)].sort()).toEqual([])
  })

  it('protocol is a pure sink: zod only, no first-party imports, no node/electron', () => {
    const proto = EDGES.filter((e) => e.fromPkg.name === '@acorn/protocol')
    const allowed = new Set(['zod', 'vitest'])
    const badExternal = proto.filter((e) => e.target.external && !allowed.has(e.target.external)).map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    const badFirstParty = proto.filter((e) => e.target.pkg && e.target.pkg.name !== '@acorn/protocol').map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    expect([...new Set([...badExternal, ...badFirstParty])].sort()).toEqual([])
  })

  it('spawning a child process is an enumerated exception to the broker', () => {
    // Every entry below is a considered exception to the broker, with its reason inline
    // (docs/architecture-overview.md § Package boundaries, docs/security.md § Process, path, and
    // configuration controls).
    const CHILD_PROCESS_OK = new Set([
      // Core, and the broker itself.
      'packages/node-core/src/main/core/exec/proc.ts', // IS the broker
      'packages/node-core/src/main/archive.ts', // bounded git archive
      'packages/node-core/src/main/headless.ts', // one-shot agent run, streams stdout as it goes
      'packages/node-core/src/main/mcpRegister.ts', // registers the MCP server with a CLI
      'packages/node-core/src/main/profiles.ts', // probes whether an agent CLI is installed
      'packages/node-core/src/main/tls.ts', // openssl, at first boot only
      // Composition roots: a login-shell PATH probe, and the supervised node's own child.
      'apps/node/src/service/runtime.ts',
      'apps/desktop/src/app/main/serviceHost.ts',
      // Long-lived engines. Each owns its children's lifetime, and the broker has no model for that.
      'plugins/terminal/src/main/terminal.ts', // PTYs
      'plugins/agents/src/main/drivers/jsonRpcProcess.ts', // ACP driver, one process per session
      'plugins/agents/src/main/drivers/claudeDriver.ts',
      'plugins/agents/src/main/drivers/codexDriver.ts',
      'plugins/agents/src/main/drivers/authProbe.ts',
      'plugins/agents/src/main/usage/codexUsage.ts',
      'plugins/docker/src/main/cli.ts',
      'plugins/docker/src/main/dockerService.ts', // `docker logs -f` / `stats` streams
      'plugins/database/src/main/database.ts',
      'plugins/editor/src/main/search.ts', // ripgrep, streamed
      'plugins/http/src/server/send.ts',
    ])
    const importers = [...new Set(
      // Build tooling excluded: apps/desktop/scripts/ runs at package time and never ships.
      EDGES.filter((e) => !isTestCode(e.fromFile) && !/\/scripts\//.test(rel(e.fromFile)))
        .filter((e) => e.target.external === 'node:child_process' || e.target.external === 'child_process')
        .map((e) => rel(e.fromFile)),
    )].sort()
    // Anti-vacuity: the broker itself must always be in the result, or the matcher has stopped matching.
    expect(importers).toContain('packages/node-core/src/main/core/exec/proc.ts')
    expect(importers.filter((f) => !CHILD_PROCESS_OK.has(f))).toEqual([])
  })

  it('plugins reach the host only through @acorn/plugin-api', () => {
    // `"exports": { "./*": "./src/*" }` gives the module system no encapsulation, so this is where a
    // plugin's import surface is enforced instead: the facade, the wire types, another plugin's
    // contract/, and its own files.
    const ALLOWED_CSS = new Set([
      // A stylesheet isn't re-exportable, since `export … from` carries bindings and this file has none.
      // Core-owned CSS for a core-owned component the plugin renders.
      '@acorn/client-core/workspaces/onboarding.css',
    ])
    const offenders = crossPackage
      .filter((e) => e.fromPkg.kind === 'plugin' && !isTestCode(e.fromFile))
      .filter((e) => e.target.pkg!.name !== '@acorn/plugin-api' && e.target.pkg!.name !== '@acorn/protocol')
      .filter((e) => !isContract(e.target.pkg, e.target.file))
      .filter((e) => !ALLOWED_CSS.has(e.spec))
      .map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    // Anti-vacuity: the facade must actually be carrying the traffic.
    expect(crossPackage.filter((e) => e.target.pkg!.name === '@acorn/plugin-api').length).toBeGreaterThan(200)
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  it('plugin TESTS reach core through @acorn/plugin-api/testkit (shrinking baseline)', () => {
    // Shrinking baseline (docs/architecture-overview.md § Package boundaries). Migrate a test as you
    // touch it; never add a root. Lower MAX_DEEP_IMPORTS below when you migrate a file.
    const TESTKIT_BASELINE = [
      '@acorn/client-core/node',
      '@acorn/client-core/palette',
      '@acorn/client-core/registries',
      '@acorn/client-core/settings',
      '@acorn/client-core/tasks',
      '@acorn/client-core/ui',
      '@acorn/client-core/wsClient.ts',
      '@acorn/node-core/main',
      '@acorn/node-core/main/core',
      '@acorn/node-core/server',
      '@acorn/node-core/server/db',
      '@acorn/node-core/server/integrations',
      '@acorn/node-core/server/middleware',
      '@acorn/node-core/server/routes',
      '@acorn/node-core/testkit',
    ]
    // 167 across 48 files the day before the testkit landed; 147 across 37 once the first eleven moved.
    const MAX_DEEP_IMPORTS = 147
    const rootOf = (spec: string): string => {
      const pkg = spec.startsWith('@acorn/node-core/') ? '@acorn/node-core/' : '@acorn/client-core/'
      const parts = spec.slice(pkg.length).split('/')
      if (parts.length === 1) return spec
      return pkg + (parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0])
    }
    const deep = EDGES.filter((e) => e.fromPkg.kind === 'plugin' && isTestCode(e.fromFile))
      .filter((e) => e.spec.startsWith('@acorn/node-core/') || e.spec.startsWith('@acorn/client-core/'))
    expect([...new Set(deep.map((e) => rootOf(e.spec)))].sort()).toEqual([...TESTKIT_BASELINE].sort())
    expect(deep.length).toBeLessThanOrEqual(MAX_DEEP_IMPORTS)
    // Anti-vacuity: the seam has to be carrying traffic, or this rule is measuring a migration that
    // never started.
    expect(EDGES.filter((e) => e.spec === '@acorn/plugin-api/testkit').length).toBeGreaterThan(4)
  })

  it('the testkit is imported only by tests', () => {
    // Keeps a production file from importing test scaffolding, which is how a tmp-dir SQLite factory
    // ends up shipped. Any package's testkit/, not just node-core's: the rule immediately found the
    // same shape in plugins/github.
    const offenders = EDGES.filter((e) => !isTestCode(e.fromFile))
      .filter((e) => e.target.file?.includes('/src/testkit/'))
      .map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  it('plugins broadcast through the plugin context (shrinking baseline)', () => {
    // Plugins used to deep-import main/wsHub.ts and main/notify.ts because NodePluginContext had no
    // `events` member. Keep this ratchet empty: a new direct import is a regression, not an item to
    // append here.
    const BROADCAST_BASELINE: string[] = []
    const HUB = ['@acorn/node-core/main/wsHub.ts', '@acorn/node-core/main/notify.ts']
    const offenders = EDGES.filter((e) => e.fromPkg.kind === 'plugin' && !e.isTest)
      .filter((e) => HUB.includes(e.spec))
      .map((e) => rel(e.fromFile))
    expect([...new Set(offenders)].sort()).toEqual([...BROADCAST_BASELINE].sort())
  })

  it('apps reach plugins through entrypoints or contract/ (shrinking baseline)', () => {
    // Empty, and stays that way (docs/architecture-overview.md § Package boundaries: what an app may
    // import). Tests are exempt.
    const APP_DEEP_IMPORT_BASELINE: string[] = []
    const ENTRYPOINTS = ['/node/index.ts', '/client/index.ts', '/main/index.ts']
    const deep = EDGES.filter((e) => e.fromPkg.kind === 'app' && !isTestCode(e.fromFile))
      .filter((e) => e.target.pkg?.kind === 'plugin' && e.target.pkg.name !== e.fromPkg.name)
      .filter((e) => {
        const rest = e.spec.split('/').slice(2)
        return rest.length > 0 && rest[0] !== 'contract' && !ENTRYPOINTS.some((entry) => e.spec.endsWith(entry))
      })
      .map((e) => e.spec)
    expect([...new Set(deep)].sort()).toEqual([...APP_DEEP_IMPORT_BASELINE].sort())
  })

  it('protocol declares no plugin route', () => {
    // docs/architecture-overview.md § Package boundaries: @acorn/protocol owns no plugin's wire
    // surface.
    const proto = byName.get('@acorn/protocol')!
    const files = walk(proto.src)
    // Anti-vacuity: the suite's own guard counts packages and edges, not protocol's files, so a walk
    // that returned nothing would satisfy the assertion below.
    expect(files.length).toBeGreaterThan(15)
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('/v2/p/')).map((f) => relative(proto.src, f))
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  it('the reserved plugin route segment is spelled the same on both sides of the client/node boundary', () => {
    // Two spellings that must not drift (docs/architecture-overview.md § Package boundaries).
    const client = byName.get('@acorn/client-core')!
    const node = byName.get('@acorn/node-core')!
    const corePaths = readFileSync(join(client.src, 'registries/corePaths.ts'), 'utf8')
    const manifest = readFileSync(join(node.src, 'main/pluginManifest.ts'), 'utf8')
    const segment = /export const PLUGIN_ROUTE_SEGMENT = '([^']+)'/.exec(corePaths)?.[1]
    expect(segment).toBe('x')
    expect(manifest).toContain(`\`/p/:projectId/${segment}/\${manifest.id}/\``)
  })

  it('protocol modules named for a plugin are an enumerated, shrinking set', () => {
    // The routes are gone, but a plugin's types can still accumulate here. Each survivor has a reason:
    const PLUGIN_NAMED_BASELINE = [
      // Both sides consume it, and `ServerMsg` is the terminal WS transport core's own hub speaks.
      'terminal.ts',
      // `NoteLocation` addresses a task, workspace or global scope, which is core's own scheme.
      'notes.ts',
      // The workflow row types are read by client-core's notification pipeline as well as the plugin.
      'workflow.ts',
      // Blocked, not kept: client-core/registries/agentToolRenderers.ts imports it, so it can't move
      // until the shell stops naming agents.
      'managedAgents.ts',
    ]
    // Not in the baseline, because a baseline means "still to fix" and these aren't. Both are name
    // collisions with core vocabulary, not dependencies.
    const NAME_COLLISIONS = ['agentContext.ts', 'contextMenus.ts']
    const pluginNames = PACKAGES.filter((p) => p.kind === 'plugin').map((p) => p.name.replace('@acorn/plugin-', ''))
    const proto = byName.get('@acorn/protocol')!
    const named = walk(proto.src)
      .map((f) => relative(proto.src, f))
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => !NAME_COLLISIONS.includes(f))
      // Matched on the file name, not the contents: a comment can't create a dependency, and scanning
      // prose for 'context' or 'http' would flag half of core's English.
      .filter((f) => pluginNames.some((n) => f.toLowerCase().replace(/s?\.ts$/, '').includes(n.replace(/s$/, ''))))
    expect([...new Set(named)].sort()).toEqual([...PLUGIN_NAMED_BASELINE].sort())
  })

  it('only core reaches the machine identity store', () => {
    // Core seams are not reachable around (docs/architecture-overview.md § Package boundaries).
    const IDENTITY_STORE_OK = new Set(['packages/node-core', 'apps/node'])
    const offenders = PACKAGES.flatMap((p) =>
      walk(p.src)
        .filter((f) => !/\.test\.tsx?$/.test(f))
        .filter((f) => /\bACTIVE_IDENTITY\b\s*[.:=)]/.test(readFileSync(f, 'utf8')))
        .map(() => relative(ROOT, p.dir)),
    )
    expect([...new Set(offenders)].filter((p) => !IDENTITY_STORE_OK.has(p)).sort()).toEqual([])
    // Anti-vacuity: the regex must still match the declaration and the two reads in the auth middleware.
    expect([...new Set(offenders)]).toContain('packages/node-core')
  })

  it('only main touches the third-party plugin cache and trust store', () => {
    // Core seams are not reachable around (docs/architecture-overview.md § Package boundaries).
    // client-core/plugins/host.ts is the one door on the renderer side, speaking hashes and
    // decisions only.
    const PLUGIN_STORE_OK = new Set(['apps/desktop'])
    const offenders = PACKAGES.flatMap((p) =>
      walk(p.src)
        .filter((f) => /\b(?:PluginCache|PluginTrustStore)\b/.test(readFileSync(f, 'utf8')))
        .map(() => relative(ROOT, p.dir)),
    )
    expect([...new Set(offenders)].filter((p) => !PLUGIN_STORE_OK.has(p)).sort()).toEqual([])
    // Anti-vacuity: the regex must still find the classes and their tests.
    expect([...new Set(offenders)]).toContain('apps/desktop')
  })

  it('the Electron surface stays where it is declared', () => {
    // apps/desktop is the Electron app, so anything in it may name electron.
    //
    // Comments are stripped here, unlike the graph scan at the top of this file: both files that got the
    // lazy treatment describe the import they used to have, in the form they used to have it, and a rule
    // that fails the fix it documents is a rule people delete.
    const ELECTRON_VALUE_IMPORT = /\b(?:import|export)\s+(?!type\b)([^'"]*?)\s+from\s*['"]electron['"]/g
    const importsElectronValues = (source: string): boolean => {
      const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      ELECTRON_VALUE_IMPORT.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ELECTRON_VALUE_IMPORT.exec(text))) {
        // A named clause of only `type X` entries is type-only in substance.
        const named = m[1].trim().match(/^\{([\s\S]*)\}$/)
        if (named && named[1].split(',').every((part) => !part.trim() || /^type\s/.test(part.trim()))) continue
        return true
      }
      return false
    }
    // The edge scan already found every file that names electron; this only decides how.
    const naming = [...new Set(EDGES.filter((e) => e.target.external === 'electron').map((e) => e.fromFile))]
    const offenders = naming.filter((f) => !rel(f).startsWith('apps/desktop/')).filter((f) => importsElectronValues(readFileSync(f, 'utf8')))
    // Anti-vacuity: the regex must still recognise the real form, which apps/desktop is full of.
    expect(naming.filter((f) => importsElectronValues(readFileSync(f, 'utf8'))).length).toBeGreaterThan(5)
    // And the forms no file in the tree happens to use, so the predicate is pinned rather than trusted.
    expect(importsElectronValues("export { app } from 'electron'")).toBe(true)
    expect(importsElectronValues("export * from 'electron'")).toBe(true)
    expect(importsElectronValues("export type { BrowserWindow } from 'electron'")).toBe(false)
    expect(importsElectronValues("import type { App } from 'electron'")).toBe(false)
    expect(importsElectronValues("import { type App, type Menu } from 'electron'")).toBe(false)
    expect(offenders.map(rel).sort()).toEqual([])
  })

  it('the platform seam is the only door to the host (shrinking baseline)', () => {
    // A source scan rather than a graph edge, because the global is read rather than imported:
    // `acornGlobal` is module-private inside platform/index.ts, so `window.acorn` is the only spelling
    // left to police. Comments are stripped, same reasoning as the electron rule. Tests are exempt
    // permanently: stubbing `globalThis.window` is how the platform implementation gets exercised.
    const READS_GLOBAL = /\bwindow\s*(?:\.\s*acorn\b|\?\.\s*acorn\b|\[\s*['"]acorn['"]\s*\])/
    const readsHostGlobal = (source: string): boolean =>
      READS_GLOBAL.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    const SEAM = join(ROOT, 'packages', 'client-core', 'src', 'platform') + '/'
    // The preload writes the global (exposeInMainWorld) rather than reading it, so it doesn't match.
    // Named here so the next implementation knows where the other end of this contract lives.
    const files = PACKAGES.flatMap((p) => walk(p.src))
      .filter((f) => !isTestCode(f) && !f.startsWith(SEAM))
      .filter((f) => readsHostGlobal(readFileSync(f, 'utf8')))
    // Baseline, not an allowlist: entries may only be removed. Empty since the seam landed. If the seam
    // doesn't carry what you need, widen the seam.
    const PLATFORM_BASELINE: string[] = []
    expect(files.map(rel).sort()).toEqual(PLATFORM_BASELINE)
    // Anti-vacuity: the predicate must still recognise the forms that used to be in the tree.
    expect(readsHostGlobal('const off = window.acorn?.onClosePane?.(cb)')).toBe(true)
    expect(readsHostGlobal("window.acorn?.preview?.evict(taskId)")).toBe(true)
    expect(readsHostGlobal("if (!window.acorn?.terminal) return null")).toBe(true)
    expect(readsHostGlobal("window['acorn'].nodeFetch(id, req)")).toBe(true)
    expect(readsHostGlobal('// the `window.acorn` global is declared in the platform seam')).toBe(false)
    expect(readsHostGlobal('const w = window.acornish')).toBe(false)
    // And the seam itself must still be doing the reading, or it's been hollowed out.
    expect(readsHostGlobal(readFileSync(join(SEAM, 'index.ts'), 'utf8'))).toBe(true)
  })

  it('client code never imports node code, and vice versa', () => {
    const crossed = firstParty
      .filter((e) => !e.isTest)
      .filter((e) => {
        const from = side(e.fromPkg, e.fromFile)
        const to = side(e.target.pkg!, e.target.file!)
        return (from === 'client' && to === 'node') || (from === 'node' && to === 'client')
      })
      .map((e) => `${rel(e.fromFile)} => ${rel(e.target.file!)}`)
    expect([...new Set(crossed)].sort()).toEqual([])
  })

  it('plugin-api is a facade: re-exports only, and only of the three core packages', () => {
    // The moment the facade grows behaviour of its own it becomes a fourth core package with its own
    // bugs.
    const api = PACKAGES.find((p) => p.name === '@acorn/plugin-api')!
    const CORE = new Set(['@acorn/node-core', '@acorn/client-core', '@acorn/protocol', '@acorn/plugin-api'])
    const foreign = EDGES.filter((e) => e.fromPkg.name === api.name && e.target.pkg && !CORE.has(e.target.pkg.name))
      .map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    // Re-exports only: no plain imports, and no declarations. `export … from` is the whole file.
    const DECLARES = /^\s*(import\s|export\s+(const|let|var|function|class|default|async)\b)/m
    // Deliberately not isTestCode(), which would also exempt src/testkit/index.ts: the entrypoint a
    // plugin's node-environment suite imports, and the one that most needs the no-components rule below.
    const entrypoints = walk(api.src).filter((f) => !/\.test\.tsx?$/.test(f))
    const declaring = entrypoints.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel)
    // Only the frame-safe ui/index.ts and compiled-host ui/host.ts barrels may re-export a `.tsx`
    // module, or that entrypoint stops loading from a plugin's node-environment suite.
    //
    // A direct-specifier grep for a transitive property, so it's incomplete: `/client` reaches
    // client-core/registries/keybindings in two hops, and `.tsx` isn't the only way to lose node-safety
    // (./ui/editor is plain `.ts` and unloadable, because monaco-editor reads `window` at module scope).
    // packages/plugin-api/src/entrypoints.test.ts is what actually knows; this stays because it's
    // instant and names the offending specifier.
    const componentEntrypoints = new Set([
      'packages/plugin-api/src/ui/index.ts',
      'packages/plugin-api/src/ui/host.ts',
    ])
    const componentLeak = entrypoints
      .filter((f) => !componentEntrypoints.has(rel(f)))
      .flatMap((f) => (readFileSync(f, 'utf8').match(/'@acorn\/[^']+\.tsx'/g) ?? []).map((spec) => `${rel(f)}: ${spec}`))
    expect(entrypoints.length).toBeGreaterThanOrEqual(4) // anti-vacuity: the walker found the entrypoints
    expect([...new Set([...foreign, ...declaring, ...componentLeak])].sort()).toEqual([])
  })

  it('client-core ui/ is pure presentation: props in, DOM out', () => {
    // ui/ is what @acorn/plugin-api/ui re-exports, so its import edges are the design-system contract.
    //
    // An allowlist of destinations, not a denylist of data modules, because a denylist silently stops
    // covering the next directory someone adds. Four carve-outs, all pure or presentation:
    //   lib/         DOM predicates, debounce, the localStorage draft helper DiffRows binds to
    //   highlight/   the shiki highlighter the diff model colours through
    //   palette/model.ts  fuzzyScore, a module with zero imports of its own
    //   registries/registry.ts  the Registry class, importing only solid-js. The container, not any
    //     instance: `registries/sources.ts` and its siblings are still application state.
    //
    // Type-only imports pass: ui/WorkspacePicker.tsx imports the `FleetWorkspace` type, a shape it
    // renders rather than a store it reads. Known and deliberate: ui/diff/DiffRows.tsx reaches
    // lib/draftState, which touches localStorage, because the draft belongs to the comment box.
    const UI_MAY_IMPORT = (file: string): boolean => {
      const p = rel(file)
      if (!p.startsWith('packages/client-core/src/')) return false
      const inner = p.slice('packages/client-core/src/'.length)
      return inner.startsWith('ui/') || inner.startsWith('lib/') || inner.startsWith('highlight/')
        || inner === 'palette/model.ts' || inner === 'registries/registry.ts'
    }
    // `[^'"]*?` for the clause, because a preceding import's specifier contains the quotes that bound
    // the statement.
    const CLAUSE_IMPORT_RE = /\bimport\s+(?!type\b)([^'"]*?)\s+from\s*['"]([^'"\n]+)['"]/g
    const BARE_IMPORT_RE = /\bimport\s*['"]([^'"\n]+)['"]/g
    const uiDir = join(ROOT, 'packages/client-core/src/ui')
    const offenders: string[] = []
    let scanned = 0
    for (const file of walk(uiDir).filter((f) => !isTestCode(f))) {
      scanned++
      const text = readFileSync(file, 'utf8')
      const specs: string[] = []
      for (const re of [CLAUSE_IMPORT_RE, BARE_IMPORT_RE]) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          if (re === CLAUSE_IMPORT_RE) {
            // A named clause whose every entry is `type X` is type-only in substance.
            const named = m[1].trim().match(/^\{([\s\S]*)\}$/)
            if (named && named[1].split(',').every((part) => !part.trim() || /^type\s/.test(part.trim()))) continue
            specs.push(m[2])
          } else specs.push(m[1])
        }
      }
      for (const spec of specs) {
        const target = resolveSpec(file, spec)
        if (!target.file) continue // external, or @acorn/protocol resolved elsewhere, both fine
        if (target.pkg && target.pkg.name !== '@acorn/client-core') continue // protocol and friends
        if (!UI_MAY_IMPORT(target.file)) offenders.push(`${rel(file)}: ${spec}`)
      }
    }
    // Anti-vacuity: the walker must actually be finding the design system.
    expect(scanned).toBeGreaterThan(15)
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  it('the package graph is acyclic (turbo topological tasks require it)', () => {
    const adj = new Map<string, Set<string>>(PACKAGES.map((p) => [p.name, new Set<string>()]))
    for (const e of crossPackage) adj.get(e.fromPkg.name)!.add(e.target.pkg!.name)
    const state = new Map<string, number>()
    const cycles: string[] = []
    const visit = (n: string, path: string[]) => {
      if (state.get(n) === 2) return
      if (state.get(n) === 1) {
        cycles.push([...path.slice(path.indexOf(n)), n].join(' -> '))
        return
      }
      state.set(n, 1)
      for (const m of adj.get(n) ?? []) visit(m, [...path, n])
      state.set(n, 2)
    }
    for (const p of PACKAGES) visit(p.name, [])
    expect([...new Set(cycles)].sort()).toEqual([])
  })

  it('a plugin contract/ never re-exports its own internals', () => {
    // A contract file must not smuggle the internals back in. Transitively, not just the direct edge:
    // `contract/x.ts -> shared/y.ts -> main/heavy.ts` reaches the implementation in one extra hop, and
    // `side()` classifies `shared` as 'shared', so no other rule stops it.
    const internal = (pkg: Pkg, file: string) => ['client', 'server', 'main'].includes(segment(pkg, file))
    const withinPkg = new Map<string, { file: string; spec: string }[]>()
    for (const e of firstParty) {
      if (e.target.pkg!.name !== e.fromPkg.name) continue
      const list = withinPkg.get(e.fromFile) ?? []
      list.push({ file: e.target.file!, spec: e.spec })
      withinPkg.set(e.fromFile, list)
    }
    const leaks: string[] = []
    for (const start of firstParty.filter((e) => isContract(e.fromPkg, e.fromFile))) {
      const pkg = start.fromPkg
      const seen = new Set<string>()
      const queue: { file: string; path: string }[] = [{ file: start.target.file!, path: start.spec }]
      while (queue.length) {
        const step = queue.shift()!
        if (seen.has(step.file)) continue
        seen.add(step.file)
        if (internal(pkg, step.file)) {
          leaks.push(`${rel(start.fromFile)}: ${step.path} (${rel(step.file)})`)
          continue
        }
        for (const next of withinPkg.get(step.file) ?? []) queue.push({ file: next.file, path: `${step.path} -> ${next.spec}` })
      }
    }
    expect([...new Set(leaks)].sort()).toEqual([])
  })

  it('plugin server code owns its own schema (shrinking baseline)', () => {
    const SCHEMA_BASELINE: string[] = []
    // Any import from core's db module that isn't exclusively type-only.
    //
    // `[^'"]*?` for the clause, not `[^;]*?`. A clause never contains a quote but a preceding import's
    // specifier does, so in semicolon-free source the lazy match spanned two statements.
    const DB_IMPORT_RE = /\bimport\s+(?!type\b)([^'"]*?)\s+from\s*['"]@acorn\/node-core\/server\/db[^'"]*['"]/g
    const importsCoreTables = (text: string): boolean => {
      DB_IMPORT_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = DB_IMPORT_RE.exec(text))) {
        // A named clause of only `type X` entries is type-only in substance.
        const clause = m[1].trim()
        const named = clause.match(/^\{([\s\S]*)\}$/)
        if (named && named[1].split(',').every((part) => !part.trim() || /^type\s/.test(part.trim()))) continue
        return true
      }
      return false
    }
    // Production code only: a test that seeds core's `tasks` or `repo_paths` is legitimate, and counting
    // those would make this ratchet impossible to zero.
    const offenders = PACKAGES.filter((p) => p.kind === 'plugin')
      .filter((p) =>
        walk(p.src)
          .filter((file) => !isTestCode(file))
          .some((file) => importsCoreTables(readFileSync(file, 'utf8'))),
      )
      .map((p) => p.name.replace('@acorn/plugin-', ''))
    expect([...new Set(offenders)].sort()).toEqual([...SCHEMA_BASELINE].sort())
  })

  it('a contribution props type never names a member `ref`', () => {
    // Solid rewrites `ref={value}` on a component into a `ref(r$)` call, so a contribution whose props
    // declare `ref` as data receives a function instead. That shipped: a Linear reference panel opened
    // with a blank title over an empty frame, and TypeScript can't see it because `ref` lives on
    // `IntrinsicAttributes`. A callback `ref` is the legitimate form, so that's what the rule allows.
    // Scoped to registries/, where the props types that cross a registry call site are declared.
    const dir = join(ROOT, 'packages/client-core/src/registries')
    const files = walk(dir).filter((f) => !isTestCode(f))
    const offenders: string[] = []
    for (const file of files) {
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        // An indented `ref:` or `ref?:` member declaration. A same-named function parameter never starts
        // its line, and neither does an inline union member.
        const declared = /^\s+ref\??:\s*(.+?)[,;]?\s*$/.exec(line)
        // `(el) => void` and `((el) => void) | undefined` are both fine; a type is not.
        if (declared && !/^\(+[^)]*\)\s*=>/.test(declared[1])) offenders.push(`${rel(file)}:${index + 1}`)
      }
    }
    // Anti-vacuity: the registries are where the contribution contracts live, and there are many.
    expect(files.length).toBeGreaterThan(15)
    expect(files.some((f) => /Props/.test(readFileSync(f, 'utf8')))).toBe(true)
    expect(offenders).toEqual([])
  })

  it('no plugin imports another outside contract/', () => {
    const seen = crossPackage
      .filter((e) => e.fromPkg.kind === 'plugin' && e.target.pkg!.kind === 'plugin')
      // Importing another plugin's contract/ is sanctioned, not coupling: it carries types and
      // capability or event ids only.
      .filter((e) => !isContract(e.target.pkg, e.target.file))
      .map((e) => `${e.fromPkg.name} -> ${e.target.pkg!.name}`)
    expect([...new Set(seen)].sort()).toEqual([])
  })

  // A CSS class defined in a plugin's stylesheet must not be worn by markup outside that plugin.
  //
  // This kept happening: `.linear-md` worn by notes and defined by github, `.editor-save` worn by notes
  // and defined by editor, `.new-pr-btn` worn by docker and defined by github, `.file-status*` worn by
  // core's diff rows and defined by github. Each meant a pane silently lost its styling when an
  // unrelated plugin was switched off, invisible to the compiler.
  it('no plugin stylesheet styles another package\'s markup', () => {
    const pluginDirs = readdirSync(join(ROOT, 'plugins'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name)

    // Class names too generic or structural to attribute by grep: state flags a plugin sets on its own
    // elements, plus the shared vocabularies that live in core.
    const SHARED = /^(ui-|diff-|is-|has-|active$|muted$|glyph$|placeholder$|spin$|truncate$|scroll$|mono$|list-reset$|markdown$)/

    // `walk` yields only JS and TS, so it silently returns no stylesheets, which made the first draft of
    // this rule pass unconditionally.
    const cssIn = (dir: string, out: string[] = []): string[] => {
      if (!existsSync(dir)) return out
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) cssIn(p, out)
        else if (e.name.endsWith('.css')) out.push(p)
      }
      return out
    }

    const offenders: string[] = []
    for (const plugin of pluginDirs) {
      const cssFiles = cssIn(join(ROOT, 'plugins', plugin))
      const declared = new Set<string>()
      for (const file of cssFiles) {
        const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        for (const group of text.match(/[^{}]+(?=\{)/g) ?? []) {
          for (const selector of group.split(',')) {
            // Ownership is the first class of the first compound unit. `.a.b` is a modifier on `.a`, and
            // `.a .b` is this plugin scoping something inside its own container.
            const first = selector.trim().match(/^\.([a-zA-Z][\w-]*)/)
            if (first && !SHARED.test(first[1])) declared.add(first[1])
          }
        }
      }
      if (!declared.size) continue

      // Every .tsx outside this plugin. A class is "worn" when it appears inside a class attribute.
      const outside = [join(ROOT, 'packages'), join(ROOT, 'apps', 'desktop', 'src'), join(ROOT, 'plugins')]
        // `.flatMap(walk)` would hand walk the array index as its accumulator. Call it explicitly.
        .filter(existsSync).flatMap((d) => walk(d))
        .filter((f) => f.endsWith('.tsx') && !f.startsWith(join(ROOT, 'plugins', plugin) + '/'))
      for (const file of outside) {
        const text = readFileSync(file, 'utf8')
        for (const attr of text.match(/class(?:List)?=\{?[^}\n]*/g) ?? []) {
          for (const name of declared) {
            if (new RegExp(`[\\s"'\`{]${name}[\\s"'\`}:,]`).test(attr)) {
              offenders.push(`plugins/${plugin} defines .${name}, worn by ${relative(ROOT, file)}`)
            }
          }
        }
      }
    }
    // Shrinking baseline. Everything left is one plugin contributing markup into another's container, so
    // the markup belongs to the guest and the box belongs to the host. That wants a real seam rather
    // than a rename, and entries may only be removed.
    //
    // The two survivors are context's vocabulary: `.context-tray-kind` and `.context-tray-label` are
    // worn by ContextPane too. They don't go until memory's section stops being a component in context's
    // realm. The cooperative extension point can't take it: the section renders editable inputs, a
    // select, a textarea and a per-proposal accept/reject gate, which is UI rather than a descriptor.
    const BASELINE = [
      'plugins/agents defines .agent-path-link, worn by plugins/changes/src/client/agentToolRenderer.tsx',
      'plugins/agents defines .agent-tool, worn by plugins/changes/src/client/agentToolRenderer.tsx',
      'plugins/context defines .context-tray-kind, worn by plugins/memory/src/client/MemorySection.tsx',
      'plugins/context defines .context-tray-label, worn by plugins/memory/src/client/MemorySection.tsx',
      'plugins/editor defines .tree, worn by plugins/changes/src/client/ChangesPane.tsx',
    ]
    expect([...new Set(offenders)].sort()).toEqual(BASELINE)
  })
})
