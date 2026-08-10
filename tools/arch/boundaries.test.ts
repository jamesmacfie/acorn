import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Architecture boundary enforcement for the current workspace (docs/architecture-overview.md).
// The scanner resolves relative and bare @acorn/* specifiers so the package graph is checked across
// both intra-package and cross-package imports.
// the suite asserts up front that it can still see a non-trivial graph.
//
// Test files follow the same package graph rules as production files unless a specific rule grants an
// explicit exception.

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
    // Kind comes from WHERE a package lives, not from what it is called. It used to key off the
    // `@acorn/plugin-` name prefix, which quietly made `@acorn/plugin-api` — a shared library in
    // packages/ that every plugin imports — classify as a plugin, inverting three rules at once.
    const base = basename(dirname(dir))
    const kind: Pkg['kind'] = base === 'apps' ? 'app' : base === 'plugins' ? 'plugin' : 'lib'
    return { name, dir, src: join(dir, 'src'), kind }
  })

const byName = new Map(PACKAGES.map((p) => [p.name, p]))
const pkgOf = (file: string): Pkg | undefined => PACKAGES.find((p) => file.startsWith(p.dir + '/'))

// Every import form, including side-effect `import '…'` and the vi.mock family — a mock path is a
// real dependency edge, and missing them is how the database -> editor edge went undeclared.
//
// It does NOT strip comments, and that is a real sharp edge rather than a theoretical one: a comment
// containing `import('@acorn/plugin-x/…')` — the natural way to describe code you just moved — becomes a
// phantom edge, and if the path is a placeholder or has since moved it fails the resolver rule below.
// Deliberately left as is: stripping comments means parsing, the false positive is loud and immediate rather
// than silent, and the alternative failure mode (missing a real edge hidden after a `//`) is worse. Describe
// a moved import in prose, not in a form that parses.
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
  // Vite import queries select a loader/representation; they are not part of the filesystem path.
  // Keep the original specifier on the edge for diagnostics and dependency rules, but resolve the
  // underlying first-party module so `?raw`, `?url`, and future fragment-bearing imports remain
  // covered by the same existence and boundary checks.
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

// The first path segment of a file inside its package's src/ — 'client', 'server', 'main',
// 'contract', 'shared', …
const segment = (pkg: Pkg, file: string): string => relative(pkg.src, file).split('/')[0]

// contract/ is the ONE cross-plugin import surface (docs/plugins.md § Package shape). A plugin
// may import another plugin's contract/; anything else is a coupling edge.
const isContract = (pkg: Pkg | undefined, file: string | null): boolean =>
  !!pkg && !!file && pkg.kind === 'plugin' && segment(pkg, file) === 'contract'

// Test scaffolding by LOCATION rather than by filename: a `.test.ts` suffix, a package's test/ or e2e/
// tree, or its testkit/ — the last of which holds helpers that are test-only but deliberately not
// suffixed, because they are imported BY tests rather than run as one.
const isTestCode = (file: string): boolean => /\.test\.tsx?$/.test(file) || /\/(test|e2e|testkit)\//.test(rel(file))

// Which side of the client/node split a file sits on, from its path inside its package.
function side(pkg: Pkg, file: string): 'client' | 'node' | 'shared' {
  if (pkg.name === '@acorn/client-core') return 'client'
  if (pkg.name === '@acorn/node-core') return 'node'
  if (pkg.name === '@acorn/protocol') return 'shared'
  // The facade carries both halves, so it is classified per entrypoint. Without this its `node/`
  // directory would fall through to 'shared' below (the node-side segments are server/main/…,
  // deliberately not `node`, because client-core/src/node/ is the FLEET node — client code), and a
  // renderer file importing @acorn/plugin-api/node would drag node code into the bundle with no
  // rule firing.
  if (pkg.name === '@acorn/plugin-api') return segment(pkg, file) === 'node' ? 'node' : 'client'
  const seg = relative(pkg.src, file).split('/')[0]
  if (seg === 'client') return 'client'
  if (seg === 'server' || seg === 'main' || seg === 'service' || seg === 'mcp' || seg === 'wiring') return 'node'
  return 'shared'
}

describe('architecture boundaries', () => {
  // Guard against the whole suite silently going blind — every assertion below is "expect empty",
  // which a broken resolver would satisfy trivially.
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
    // packages/* -> plugins/* is the inversion that made client-core cyclic. Acyclicity alone does
    // not catch it: a plugin whose only upstream is @acorn/protocol closes no cycle.
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
    // main/core/exec/proc.ts opens by quoting docs/security.md: "all child processes go through the process
    // broker". Nineteen production modules import node:child_process directly, ten of them in plugins.
    //
    // Most of those are legitimately outside the broker's model, which captures bounded output from a
    // short-lived child and kills its process group. A PTY, a long-lived JSON-RPC agent driver, a
    // `docker logs -f` stream and a pg client are none of those things. The problem was never that the
    // exceptions exist — it is that nothing distinguished a sanctioned one from a call site that simply
    // had not been migrated, so the claim in the docs was flatly untrue and unenforceable.
    //
    // This is the list. Every entry is a considered exception, and the reason is written beside it in
    // the file itself. Adding one is a decision; docs/security.md now describes THIS, not the universal
    // claim it used to make.
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
      // Build tooling excluded: apps/desktop/scripts/ runs at package time and never ships, so the
      // broker's confinement guarantees have nothing to say about it.
      EDGES.filter((e) => !isTestCode(e.fromFile) && !/\/scripts\//.test(rel(e.fromFile)))
        .filter((e) => e.target.external === 'node:child_process' || e.target.external === 'child_process')
        .map((e) => rel(e.fromFile)),
    )].sort()
    // Anti-vacuity: the broker itself must always be in the result, or the matcher has stopped matching.
    expect(importers).toContain('packages/node-core/src/main/core/exec/proc.ts')
    expect(importers.filter((f) => !CHILD_PROCESS_OK.has(f))).toEqual([])
  })

  it('plugins reach the host only through @acorn/plugin-api', () => {
    // Every package declares `"exports": { "./*": "./src/*" }`, so there is no encapsulation at the
    // module-system level at all — a plugin can reach any file in core. This used to be answered
    // with a reviewed list of module roots; it is now answered with a package. @acorn/plugin-api
    // re-exports an enumerated surface, its own snapshot test makes growing that surface a
    // deliberate act, and a third-party plugin can depend on it without inheriting the server.
    //
    // A plugin's first-party imports are therefore: the facade, the wire types, another plugin's
    // contract/, and its own files. Nothing else in packages/.
    const ALLOWED_CSS = new Set([
      // A stylesheet is not re-exportable — `export … from` carries bindings, and these files have
      // none. Both are core-owned CSS for a core-owned component the plugin renders.
      '@acorn/client-core/palette/palette.css',
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

  it('plugin TESTS import core through a reviewed set of module roots (ratchet)', () => {
    // Production code goes through the facade; test scaffolding does not, and should not be forced
    // to. A test that seeds core's tables, builds a real CoreServices or opens a tmp-dir database is
    // reaching for the HOST, not for an API — a third-party author gets a testkit entrypoint if and
    // when one is built, and inventing that surface now would mean publishing core's internals as
    // contract to satisfy first-party fixtures.
    //
    // ROOTS, not files: the value here is the review. A new entry means someone opened a new seam
    // and had to say so; a new file under an existing root is ordinary work.
    const TEST_IMPORT_ROOTS = [
      '@acorn/client-core/lib',
      '@acorn/client-core/node',
      '@acorn/client-core/palette',
      '@acorn/client-core/registries',
      '@acorn/client-core/settings',
      '@acorn/client-core/tasks',
      '@acorn/client-core/ui',
      '@acorn/client-core/ui/diff',
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
    const rootOf = (spec: string): string => {
      const pkg = spec.startsWith('@acorn/node-core/') ? '@acorn/node-core/' : '@acorn/client-core/'
      const parts = spec.slice(pkg.length).split('/')
      if (parts.length === 1) return spec
      return pkg + (parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0])
    }
    const used = EDGES.filter((e) => e.fromPkg.kind === 'plugin' && isTestCode(e.fromFile))
      .filter((e) => e.spec.startsWith('@acorn/node-core/') || e.spec.startsWith('@acorn/client-core/'))
      .map((e) => rootOf(e.spec))
    expect([...new Set(used)].sort()).toEqual([...TEST_IMPORT_ROOTS].sort())
  })

  it('the testkit is imported only by tests', () => {
    // Three test helpers used to live in packages/node-core/src/server/routes/ — testDb.ts with sixty
    // inbound references across eleven packages, plus testAuth.ts and testIntegration.ts. Nothing about
    // them was a route; they sat there because that is where they were first needed, and every consumer
    // then imported test scaffolding through a path that reads like production surface.
    //
    // The directory rename is most of the fix: `@acorn/node-core/testkit/db.ts` says what it is at
    // every call site. This is the part the rename cannot do — keeping a production file from reaching
    // for one, which is how a tmp-dir SQLite factory ends up shipped.
    //
    // Any package's testkit/, not just node-core's: the rule immediately found the same shape in
    // plugins/github, whose seedGithubIntegration helper was sitting in server/.
    const offenders = EDGES.filter((e) => !isTestCode(e.fromFile))
      .filter((e) => e.target.file?.includes('/src/testkit/'))
      .map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  it('plugins broadcast through the plugin context (shrinking baseline)', () => {
    // docs/plugins.md promised event subscriptions and NodePluginContext had no `events` member; what
    // plugins actually did was deep-import main/wsHub.ts and main/notify.ts. The context now carries
    // the real surface (server/plugin/types.ts § PluginBroadcast), and this is the ratchet that drains
    // the imports it replaced.
    //
    // Every plugin now receives these event projections through NodePluginContext. Keep this ratchet
    // empty: a new direct import would be an architectural regression, not an item to append here.
    const BROADCAST_BASELINE: string[] = []
    const HUB = ['@acorn/node-core/main/wsHub.ts', '@acorn/node-core/main/notify.ts']
    const offenders = EDGES.filter((e) => e.fromPkg.kind === 'plugin' && !e.isTest)
      .filter((e) => HUB.includes(e.spec))
      .map((e) => rel(e.fromFile))
    expect([...new Set(offenders)].sort()).toEqual([...BROADCAST_BASELINE].sort())
  })

  it('apps reach plugins through entrypoints or contract/ (shrinking baseline)', () => {
    // A plugin's public surface is its three entrypoints — node/index.ts, client/index.ts,
    // main/index.ts — plus contract/, which is also what another plugin may import. An app is allowed
    // to know more than a plugin does, but "allowed to import anything" is how a composition root ends
    // up depending on an internal module that was never meant to be load-bearing. That is what this
    // ratchet measures: it may only shrink.
    //
    // The baseline is empty: composition roots consume only node/index.ts, client/index.ts,
    // main/index.ts, or contract/ surfaces. Keep this ratchet empty as an import-boundary guard.
    //
    // Tests are exempt. A test may reach into whatever it is testing, and holding integration tests to
    // the production surface would only push them into re-exporting internals through it.
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
    // The rule that keeps api.ts from becoming a mixing bowl again. It was 701 lines holding route
    // builders for nine plugins' namespaces, which meant no plugin could define its own wire surface
    // without editing core — the single largest blocker to third-party plugins.
    //
    // One literal does the whole job with no name list and no false positives: every plugin route
    // lives under /v2/p/<plugin>/ and core's under /v2/core/. If protocol contains the plugin prefix,
    // it is building a route it does not own.
    const proto = byName.get('@acorn/protocol')!
    const files = walk(proto.src)
    // Anti-vacuity for THIS rule: the guard at the top of the suite counts packages and edges, not
    // protocol's own files, so a walk that returned nothing would satisfy the assertion below.
    expect(files.length).toBeGreaterThan(15)
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('/v2/p/')).map((f) => relative(proto.src, f))
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  it('protocol modules named for a plugin are an enumerated, shrinking set', () => {
    // The routes are gone (rule above), but a plugin's TYPES can still accumulate here without one.
    // This is the ratchet for that: an explicit list, in the SCHEMA_BASELINE style, so adding a
    // plugin-shaped module to protocol is a decision someone has to write down rather than a drift.
    //
    // Each survivor is here for a stated reason, not by neglect:
    const PLUGIN_NAMED_BASELINE = [
      // Both sides consume it and `ServerMsg` is the terminal WS transport itself, which core's own
      // hub (main/wsHub.ts) speaks. Core vocabulary that happens to share a plugin's name.
      'terminal.ts',
      // `NoteLocation` addresses a task/workspace/global scope — core's own addressing scheme. The
      // notes ROUTES that used it moved to plugins/notes/src/shared/api.ts.
      'notes.ts',
      // The workflow row types are read by client-core's notification pipeline as well as the plugin.
      'workflow.ts',
      // Blocked, not kept: client-core/registries/agentToolRenderers.ts imports it, so it cannot move
      // until the shell stops naming agents (finding 10).
      'managedAgents.ts',
    ]
    // Kept OUT of the baseline on purpose, because a baseline means "still to fix" and these are not.
    // The match is a name collision with core vocabulary, not a dependency: `AgentContextContribution`
    // is client-core's registry type and has nothing to do with plugins/context.
    const NAME_COLLISIONS = ['agentContext.ts']
    const pluginNames = PACKAGES.filter((p) => p.kind === 'plugin').map((p) => p.name.replace('@acorn/plugin-', ''))
    const proto = byName.get('@acorn/protocol')!
    const named = walk(proto.src)
      .map((f) => relative(proto.src, f))
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => !NAME_COLLISIONS.includes(f))
      // Matched on the FILE NAME, not the contents: a comment cannot create a dependency, and
      // scanning prose for 'context' or 'http' would flag half of core's English.
      .filter((f) => pluginNames.some((n) => f.toLowerCase().replace(/s?\.ts$/, '').includes(n.replace(/s$/, ''))))
    expect([...new Set(named)].sort()).toEqual([...PLUGIN_NAMED_BASELINE].sort())
  })

  it('only core reaches the machine identity store', () => {
    // The node's identity used to be WRITTEN by a feature plugin: plugins/github's device-flow route
    // set `c.env.ACTIVE_IDENTITY` after connecting an account, so core's answer to "who is the user"
    // was a side effect of one provider. It is now minted by core at boot (main/core/identity/identity.ts),
    // and providers only consume the read-only CoreServices.identity seam.
    //
    // This rule keeps the raw store out of reach so the inversion cannot come back. The allowlist is
    // node-core, which owns the store, plus the two composition roots, which construct it and hand it
    // to createCoreServices — the one legitimate reason to name it outside core. A plugin appearing
    // here means someone went around the seam again.
    const IDENTITY_STORE_OK = new Set(['packages/node-core', 'apps/node'])
    const offenders = PACKAGES.flatMap((p) =>
      walk(p.src)
        .filter((f) => !/\.test\.tsx?$/.test(f))
        .filter((f) => /\bACTIVE_IDENTITY\b\s*[.:=)]/.test(readFileSync(f, 'utf8')))
        .map(() => relative(ROOT, p.dir)),
    )
    expect([...new Set(offenders)].filter((p) => !IDENTITY_STORE_OK.has(p)).sort()).toEqual([])
    // Anti-vacuity: the regex above must still match the declaration and the two reads in the auth
    // middleware, or this rule passes because it stopped finding anything at all.
    expect([...new Set(offenders)]).toContain('packages/node-core')
  })

  it('only main touches the third-party plugin cache and trust store', () => {
    // Two invariants from docs/plugins.md, both of which are only
    // invariants while nothing outside main can name the stores.
    //
    // "Trust binds to bytes": the acknowledgement is bound to a hash the MAIN process computed from
    // the bytes it received. A renderer-side module that read or wrote either store would be a second
    // place a hash could enter the system, which is exactly the property a compromised node needs.
    //
    // "The renderer stays inert": bundle bytes and cache paths never cross contextBridge. The client
    // reaches both stores through client-core/plugins/host.ts, which speaks hashes and decisions and
    // nothing else — and which is also the seam a future web client re-implements over IndexedDB
    // (docs/future/remote.md), so it must stay the only door.
    const PLUGIN_STORE_OK = new Set(['apps/desktop'])
    const offenders = PACKAGES.flatMap((p) =>
      walk(p.src)
        .filter((f) => /\b(?:PluginCache|PluginTrustStore)\b/.test(readFileSync(f, 'utf8')))
        .map(() => relative(ROOT, p.dir)),
    )
    expect([...new Set(offenders)].filter((p) => !PLUGIN_STORE_OK.has(p)).sort()).toEqual([])
    // Anti-vacuity: the regex must still find the classes and their tests, or this rule passes
    // because it stopped looking for anything.
    expect([...new Set(offenders)]).toContain('apps/desktop')
  })

  it('the Electron surface stays where it is declared', () => {
    // apps/desktop IS the Electron app, so anything in it may import electron. What matters is
    // that the surface OUTSIDE it stays tiny and enumerated — those are the files that would have
    // to move or grow an adapter when the node service is split out.
    const ELECTRON_OK_OUTSIDE_DESKTOP = new Set([
      'plugins/terminal/src/main/folderPickerIpc.ts',
      'plugins/preview/src/main/previewService.ts',
      'plugins/preview/src/main/browserService.ts',
    ])
    const importers = [...new Set(EDGES.filter((e) => e.target.external === 'electron').map((e) => rel(e.fromFile)))].sort()
    const outside = importers.filter((f) => !f.startsWith('apps/desktop/'))
    expect(outside.filter((f) => !ELECTRON_OK_OUTSIDE_DESKTOP.has(f))).toEqual([])
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
    // The facade's value is that it is enumerable and boring. The moment it grows behaviour of its
    // own it becomes a fourth core package with its own bugs, and "the plugin API" stops being a
    // view onto the host and starts being a thing that has to be kept in sync with it.
    const api = PACKAGES.find((p) => p.name === '@acorn/plugin-api')!
    const CORE = new Set(['@acorn/node-core', '@acorn/client-core', '@acorn/protocol', '@acorn/plugin-api'])
    const foreign = EDGES.filter((e) => e.fromPkg.name === api.name && e.target.pkg && !CORE.has(e.target.pkg.name))
      .map((e) => `${rel(e.fromFile)}: ${e.spec}`)
    // Re-exports only: no plain imports, and no declarations. `export … from` is the whole file.
    const DECLARES = /^\s*(import\s|export\s+(const|let|var|function|class|default|async)\b)/m
    const entrypoints = walk(api.src).filter((f) => !isTestCode(f))
    const declaring = entrypoints.filter((f) => DECLARES.test(readFileSync(f, 'utf8'))).map(rel)
    // Only the frame-safe ui/index.ts and compiled-host ui/host.ts barrels may re-export from a .tsx
    // module. Components anywhere else make that entrypoint unloadable from a plugin's
    // node-environment test suite. Keeping the two UI barrels separate prevents a sandboxed frame
    // importing Button from also evaluating router/query/registry machinery.
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
    // ui/ is what @acorn/plugin-api/ui re-exports, so its import edges ARE the design-system
    // contract. A component that starts wanting data gets wrapped in connected/ — a thin
    // subscribe-and-hand-rows-to-a-pure-component layer — never a fetch added in place.
    //
    // An ALLOWLIST of destinations, not a denylist of data modules: a denylist silently stops
    // covering the next directory someone adds, which is the failure mode that matters here.
    // Three carve-outs, all pure or presentation infrastructure:
    //   lib/         DOM predicates, debounce, the localStorage draft helper DiffRows binds to
    //   highlight/   the shiki highlighter the diff model colours through
    //   palette/model.ts  fuzzyScore, a module with zero imports of its own
    //
    // TYPE-ONLY imports pass. ui/WorkspacePicker.tsx does `import type { FleetWorkspace } from
    // '../workspaces/fleetWorkspaces'` — a shape it renders, not a store it reads — and a rule
    // written against all imports would fail a component that is behaving correctly.
    //
    // Known and deliberate: ui/diff/DiffRows.tsx reaches lib/draftState, which reads and writes
    // localStorage. That is a store write by the spirit of the rule; it is allowed because the
    // draft belongs to the comment box being rendered and lib/draftState.ts says so in its header.
    const UI_MAY_IMPORT = (file: string): boolean => {
      const p = rel(file)
      if (!p.startsWith('packages/client-core/src/')) return false
      const inner = p.slice('packages/client-core/src/'.length)
      return inner.startsWith('ui/') || inner.startsWith('lib/') || inner.startsWith('highlight/') || inner === 'palette/model.ts'
    }
    // Same clause-parsing idiom as the schema ratchet below: `[^'"]*?` for the clause, because a
    // preceding import's specifier contains the quotes that bound the statement.
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
        if (!target.file) continue // external, or @acorn/protocol resolved elsewhere — both fine
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
    // The contract/ exemption below is only worth having if a contract file cannot smuggle the
    // internals back in. `export type { X } from '../main/heavy.ts'` is still an import edge, and it
    // would drag the implementation module into every consumer — turning the sanctioned surface into
    // a hole. Types a contract needs must LIVE in contract/ (or in shared/, which both sides may use).
    // TRANSITIVELY, not just the direct edge. `contract/x.ts -> shared/y.ts -> main/heavy.ts` reaches the
    // implementation in one extra hop, and `side()` classifies `shared` as 'shared' so no other rule
    // stops it — which made the direct-edge version of this check cosmetic.
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
    // Any import FROM core's db module that is not exclusively type-only. Relative and bare package
    // specifiers are resolved before this rule runs. Type-only imports (`import type { AppDatabase }`)
    // are legitimate and stay.
    // `[^'"]*?` for the clause, NOT `[^;]*?`. A clause never contains a quote, but a PRECEDING import's
    // specifier does — with `[^;]*?` the lazy match happily spanned two statements in semicolon-free
    // source, so `import { readFile } from 'node:fs/promises'` followed by a type-only db import matched
    // as one, and the rule flagged a package that reads nothing. Quotes are the statement boundary here;
    // newlines are allowed on purpose, for multi-line brace clauses.
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
    // Production code only. A TEST that seeds core's `tasks`/`repo_paths` to build a fixture is
    // legitimate and always will be — counting those would make this ratchet impossible to drive to
    // zero, which is the one thing it exists to do.
    const offenders = PACKAGES.filter((p) => p.kind === 'plugin')
      .filter((p) =>
        walk(p.src)
          .filter((file) => !isTestCode(file))
          .some((file) => importsCoreTables(readFileSync(file, 'utf8'))),
      )
      .map((p) => p.name.replace('@acorn/plugin-', ''))
    expect([...new Set(offenders)].sort()).toEqual([...SCHEMA_BASELINE].sort())
  })

  it('no plugin imports another outside contract/', () => {
    const seen = crossPackage
      .filter((e) => e.fromPkg.kind === 'plugin' && e.target.pkg!.kind === 'plugin')
      // Importing another plugin's contract/ is the sanctioned mechanism, not a coupling: it carries
      // types and capability/event ids only, and the rule above keeps it that way.
      .filter((e) => !isContract(e.target.pkg, e.target.file))
      .map((e) => `${e.fromPkg.name} -> ${e.target.pkg!.name}`)
    expect([...new Set(seen)].sort()).toEqual([])
  })
})
