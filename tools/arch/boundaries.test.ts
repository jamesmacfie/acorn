import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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
    const kind = name === '@acorn/desktop' || name === '@acorn/node' ? 'app' : name.startsWith('@acorn/plugin-') ? 'plugin' : 'lib'
    return { name, dir, src: join(dir, 'src'), kind: kind as Pkg['kind'] }
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
  if (spec.startsWith('.')) {
    const file = resolveFile(resolve(dirname(from), spec))
    return { file, external: null, pkg: file ? pkgOf(file) : undefined }
  }
  if (spec.startsWith('@acorn/')) {
    const [scope, name, ...rest] = spec.split('/')
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

// Which side of the client/node split a file sits on, from its path inside its package.
function side(pkg: Pkg, file: string): 'client' | 'node' | 'shared' {
  if (pkg.name === '@acorn/client-core') return 'client'
  if (pkg.name === '@acorn/node-core') return 'node'
  if (pkg.name === '@acorn/protocol') return 'shared'
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

  it('apps reach plugins through entrypoints or contract/ (shrinking baseline)', () => {
    // A plugin's public surface is its three entrypoints — node/index.ts, client/index.ts,
    // main/index.ts — plus contract/, which is also what another plugin may import. An app is allowed
    // to know more than a plugin does, but "allowed to import anything" is how a composition root ends
    // up depending on an internal module that was never meant to be load-bearing. That is what this
    // ratchet measures: it may only shrink.
    //
    // Three of these were retired by moving their capability ids into contract/ (agents.runtime,
    // workflows.runner, memory.knowledge); the rest are honest work still to do. `profiles-*` go with
    // the Tier 3 sweep, and the `*State`/`*Slice` client modules go with finding 11, which gives
    // per-node state one registered eviction hook instead of a hand-maintained list in the shell.
    //
    // Tests are exempt. A test may reach into whatever it is testing, and holding integration tests to
    // the production surface would only push them into re-exporting internals through it.
    const APP_DEEP_IMPORT_BASELINE = [
      '@acorn/plugin-agents/client/managedStore.ts',
      '@acorn/plugin-context/client/selectionState.ts',
      '@acorn/plugin-context/client/syncState.ts',
      '@acorn/plugin-editor/client/editorState.ts',
      '@acorn/plugin-editor/client/editorTreeState.ts',
      '@acorn/plugin-editor/client/editorViewState.ts',
      '@acorn/plugin-github/client/pullList/filterState.ts',
      '@acorn/plugin-github/client/reviewViewState.ts',
      '@acorn/plugin-notes/client/notesPaneState.ts',
      '@acorn/plugin-notes/main/seedTaskNotes.ts',
      '@acorn/plugin-onboarding/client/index.tsx',
      '@acorn/plugin-preview/main/browserService.ts',
      '@acorn/plugin-preview/main/previewService.ts',
      '@acorn/plugin-profiles-aider/main/aider.ts',
      '@acorn/plugin-profiles-claude/main/claudeCode.ts',
      '@acorn/plugin-profiles-codex/main/codex.ts',
      '@acorn/plugin-terminal/main/pickerIpc.ts',
      '@acorn/plugin-terminal/main/terminal.ts',
    ]
    const ENTRYPOINTS = ['/node/index.ts', '/client/index.ts', '/main/index.ts']
    // Broader than the suite's `isTest`, which only matches the `.test.ts` suffix: an app's test tree
    // also holds fixtures and harnesses (apps/node/test/registerProviders.ts, apps/desktop/e2e/) that
    // are test code by location rather than by filename.
    const inTestTree = (file: string) => /\/(test|e2e)\//.test(rel(file))
    const deep = EDGES.filter((e) => e.fromPkg.kind === 'app' && !e.isTest && !inTestTree(e.fromFile))
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
      // Moves with finding 2, which opens the WS envelope — protocol imports DockerStatsSample from
      // here into ws.ts today, and both leave together.
      'docker.ts',
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
    // was a side effect of one provider. It is CoreServices.identity now (main/core/identity.ts), and
    // github binds through that seam like any other consumer.
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

  it('the Electron surface stays where it is declared', () => {
    // apps/desktop IS the Electron app, so anything in it may import electron. What matters is
    // that the surface OUTSIDE it stays tiny and enumerated — those are the files that would have
    // to move or grow an adapter when the node service is split out.
    const ELECTRON_OK_OUTSIDE_DESKTOP = new Set([
      'plugins/terminal/src/main/pickerIpc.ts',
      'plugins/preview/src/main/previewService.ts',
      'plugins/preview/src/main/browserService.ts',
      // colocated test that mocks the electron module it exercises
      'plugins/preview/src/main/previewService.test.ts',
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
          .filter((file) => !/\.test\.tsx?$/.test(file))
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
