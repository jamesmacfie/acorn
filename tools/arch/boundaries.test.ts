import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Architecture boundary enforcement for the vNext workspace split (docs/vNext/architecture.md).
// Makes the dependency rules executable instead of leaving them as convention.
//
// This replaces the single-package version that lived in apps/desktop/src/core. That one matched
// only specifiers starting with '.', so once first-party code moved behind @acorn/* specifiers it
// would have seen zero edges and passed every assertion vacuously — including the two hard
// invariants. Every rule below therefore resolves BOTH relative and bare @acorn/* specifiers, and
// the suite asserts up front that it can still see a non-trivial graph.
//
// Unlike the old version, test files are NOT globally exempt. A blanket exemption is what let nine
// test files import the composition root unnoticed; each rule now states its own policy.

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

// contract/ is the ONE cross-plugin import surface (docs/vNext/plugins.md § Package shape). A plugin
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
  // `wiring` is @acorn/node's: the service-owned composition glue that used to sit in app/main.
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
    // Phase 2 moves each plugin's tables into its own package and its own SQLite file
    // (docs/vNext/data.md § Plugin DBs). Until then, importing core's table definitions is
    // grandfathered per package. Entries may be removed, never added.
    //
    // The intent is to match the TABLE barrel rather than the module — but be aware of what the regex
    // below ACTUALLY does in this codebase, because it changes what "remove an entry" costs. The source
    // has no semicolons, so `[^;]*?` runs backwards past earlier import statements: a file whose only
    // db import is `import type { AppDatabase }` still matches, because the match starts at some
    // earlier `import` and the clause it captures is not a `{ … }` list of `type` entries. In practice
    // the rule therefore reads "no db-module import at all", type-only included. That is the stricter
    // and more useful reading — a plugin holding core's AppDatabase is exactly the coupling the split
    // removes — so it is left as is rather than loosened to match the comment.
    // 'changes', 'database', 'docker', 'editor' and 'memory' are off this list: each owns its own
    // schema (or no tables at all) and takes CoreServices instead of core's database. Eight to go.
    const SCHEMA_BASELINE = [
      'agents',
      'github',
      'http',
      'linear',
      'notes',
      'rollbar',
      'terminal',
      'workflows',
    ]
    // Any import FROM core's db module that is not exclusively type-only. The first version matched only
    // `{ schema }` / `* as schema`, so `import * as db from '.../db/index.ts'` + `db.schema.tasks`, or
    // `import { tasks } from '.../db/schema.ts'` — the natural form once the barrel is off-limits — both
    // slipped through. Type-only imports (`import type { AppDatabase }`) are legitimate and stay.
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

  it('plugin→plugin coupling matches the shrinking baseline', () => {
    // Phase 3 drives this to zero. Entries may be removed, never added.
    // 'changes -> github' and 'database -> editor' are off this list: the shared UI kit landed
    // (packages/client-core/src/ui/diff/* and ui/monacoSetup.ts), so both consumers now import
    // rendering code from client-core instead of another plugin's client/ internals.
    const BASELINE = [
      '@acorn/plugin-agents -> @acorn/plugin-terminal',
      '@acorn/plugin-context -> @acorn/plugin-memory',
      '@acorn/plugin-context -> @acorn/plugin-notes',
      '@acorn/plugin-github -> @acorn/plugin-linear',
      '@acorn/plugin-memory -> @acorn/plugin-notes',
      '@acorn/plugin-preview -> @acorn/plugin-terminal',
      '@acorn/plugin-workflows -> @acorn/plugin-agents',
    ]
    const seen = crossPackage
      .filter((e) => e.fromPkg.kind === 'plugin' && e.target.pkg!.kind === 'plugin')
      // Importing another plugin's contract/ is the sanctioned mechanism, not a coupling: it carries
      // types and capability/event ids only, and the rule above keeps it that way.
      .filter((e) => !isContract(e.target.pkg, e.target.file))
      .map((e) => `${e.fromPkg.name} -> ${e.target.pkg!.name}`)
    expect([...new Set(seen)].sort()).toEqual([...BASELINE].sort())
  })
})
