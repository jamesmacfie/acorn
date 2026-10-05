// Run from the repository root with the supported Node pin:
// node docs/future/trim/inventory.mjs > docs/future/trim/artifacts/phase-01-inventory.json
// This reads the lockfile and installed files. It never changes either.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, realpathSync, statSync, existsSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requiredRuntimePackages } from '../../../scripts/nodeRuntimePackages.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const packageName = (key) => key.slice(0, key.indexOf('@', 1))

function manifestInventory(importers) {
  const direct = { production: new Set(), development: new Set() }
  const declarations = { production: 0, development: 0 }
  for (const path of Object.keys(importers)) {
    const manifest = readJson(join(root, path, 'package.json'))
    for (const [section, kind] of [['dependencies', 'production'], ['optionalDependencies', 'production'], ['devDependencies', 'development']]) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        if (version.startsWith('workspace:')) continue
        direct[kind].add(name)
        declarations[kind]++
      }
    }
  }
  return {
    manifests: Object.keys(importers).length,
    workspaceManifests: Object.keys(importers).filter((path) => path !== '.').length,
    pluginManifests: Object.keys(importers).filter((path) => path.startsWith('plugins/')).length,
    declarations,
    productionNames: direct.production.size,
    developmentNames: direct.development.size,
    developmentOnlyNames: [...direct.development].filter((name) => !direct.production.has(name)).length,
    unionNames: new Set([...direct.production, ...direct.development]).size,
    names: { production: [...direct.production].sort(), development: [...direct.development].sort() },
  }
}

// The lockfile sections used here contain maps and scalar versions only. Reject an unfamiliar
// shape instead of silently treating it as a smaller graph.
function lockMaps() {
  const result = {}
  const stack = [{ indent: -1, value: result }]
  for (const line of readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const match = /^( *)(?:'((?:[^']|'')*)'|"([^"]*)"|([^:]+)):(?: (.*))?$/.exec(line)
    if (!match) {
      if (/^ *- /.test(line)) continue // Lists occur only in metadata we do not traverse.
      throw new Error(`Unrecognized lockfile line: ${line}`)
    }
    const indent = match[1].length
    const key = (match[2] ?? match[3] ?? match[4]).replaceAll("''", "'")
    while (stack.at(-1).indent >= indent) stack.pop()
    const parent = stack.at(-1).value
    const scalar = match[5]
    parent[key] = scalar === undefined || scalar === '' ? {} : scalar.replace(/^['"]|['"]$/g, '')
    if (typeof parent[key] === 'object') stack.push({ indent, value: parent[key] })
  }
  return result
}

function lockedGraph(lock) {
  const snapshots = lock.snapshots
  const importers = lock.importers
  const unresolved = new Set()
  const roots = { production: new Set(), development: new Set() }
  const direct = { production: new Set(), development: new Set() }
  const importerPaths = Object.keys(importers)

  function snapshotKey(name, version, from) {
    if (version.startsWith('link:') || version.startsWith('workspace:')) return null
    const key = `${name}@${version}`
    if (!snapshots[key]) unresolved.add(`${from} -> ${key}`)
    return snapshots[key] ? key : null
  }
  for (const [path, importer] of Object.entries(importers)) {
    for (const [section, kind] of [['dependencies', 'production'], ['optionalDependencies', 'production'], ['devDependencies', 'development']]) {
      for (const [name, item] of Object.entries(importer[section] ?? {})) {
        if (typeof item.version !== 'string') throw new Error(`No version for ${path}:${name}`)
        if (!item.version.startsWith('link:')) direct[kind].add(name)
        const key = snapshotKey(name, item.version, path)
        if (key) roots[kind].add(key)
      }
    }
  }
  const edges = new Map()
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const next = new Set()
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(snapshot[section] ?? {})) {
        if (typeof version !== 'string') throw new Error(`No version for ${key}:${name}`)
        const target = snapshotKey(name, version, key)
        if (target) next.add(target)
      }
    }
    edges.set(key, next)
  }
  function closure(start) {
    const seen = new Set()
    const pending = [...start]
    while (pending.length) {
      const key = pending.pop()
      if (seen.has(key)) continue
      seen.add(key)
      pending.push(...edges.get(key) ?? [])
    }
    return seen
  }
  const prod = closure(roots.production)
  const dev = closure(roots.development)
  const overlap = [...dev].filter((key) => prod.has(key))
  const devOnly = [...dev].filter((key) => !prod.has(key))
  // A root's removable closure is its reachability less everything reachable from other roots.
  // Shared roots (for example seroval) correctly report zero removable snapshots.
  const removableByRoot = {}
  const allRoots = new Set([...roots.production, ...roots.development])
  for (const rootKey of allRoots) {
    const other = closure(new Set([...allRoots].filter((key) => key !== rootKey)))
    removableByRoot[rootKey] = [...closure([rootKey])].filter((key) => !other.has(key)).length
  }
  const names = (keys) => new Set([...keys].map(packageName)).size
  const productionNames = new Set([...prod].map(packageName))
  const developmentNames = new Set([...dev].map(packageName))
  return {
    importers: importerPaths.length,
    direct: {
      productionNames: direct.production.size,
      developmentNames: direct.development.size,
      unionNames: new Set([...direct.production, ...direct.development]).size,
      developmentOnlyNames: [...direct.development].filter((name) => !direct.production.has(name)).length,
      names: { production: [...direct.production].sort(), development: [...direct.development].sort() },
    },
    lock: { packageEntries: Object.keys(lock.packages ?? {}).length, snapshots: Object.keys(snapshots).length, names: names(Object.keys(snapshots)) },
    closure: {
      production: { snapshots: prod.size, names: names(prod) },
      development: { snapshots: dev.size, names: names(dev) },
      overlap: { snapshots: overlap.length, names: names(overlap) },
      developmentOnly: { snapshots: devOnly.length, names: names(devOnly), namesAbsentProduction: [...developmentNames].filter((name) => !productionNames.has(name)).length },
      sharedNames: [...developmentNames].filter((name) => productionNames.has(name)).length,
      union: { snapshots: new Set([...prod, ...dev]).size, names: names(new Set([...prod, ...dev])) },
    },
    removableByRoot,
    unresolved: [...unresolved].sort(),
  }
}

const sourceExtensions = new Set(['.ts', '.tsx', '.rs', '.css', '.mjs'])
const excludedDirectories = new Set(['node_modules', 'dist', 'build', 'target', 'generated', '__generated__', 'migrations', 'testkit', 'vendor', 'vendored', '.turbo'])
function sourceCensus() {
  const counts = { files: 0, lines: 0, typescriptFiles: 0, typescriptLines: 0, testFiles: 0, excluded: [...excludedDirectories].sort() }
  function walk(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue
      const child = join(path, item.name)
      if (item.isDirectory()) {
        if (!excludedDirectories.has(item.name)) walk(child)
      } else if (item.isFile()) {
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(item.name)) { counts.testFiles++; continue }
        if (/\.d\.[cm]?ts$/.test(item.name)) continue
        const extension = item.name.slice(item.name.lastIndexOf('.'))
        if (!sourceExtensions.has(extension)) continue
        const lines = readFileSync(child, 'utf8').split('\n').length - 1
        counts.files++
        counts.lines += lines
        if (extension === '.ts' || extension === '.tsx') {
          counts.typescriptFiles++
          counts.typescriptLines += lines
        }
      }
    }
  }
  for (const area of ['apps', 'packages', 'plugins', 'tools']) walk(join(root, area))
  return counts
}

function directoryBytes(path, skipNestedModules = true) {
  let bytes = 0
  for (const item of readdirSync(path, { withFileTypes: true })) {
    if (skipNestedModules && item.name === 'node_modules') continue
    const child = join(path, item.name)
    if (item.isDirectory()) bytes += directoryBytes(child, skipNestedModules)
    else if (item.isFile()) bytes += statSync(child).size
  }
  return bytes
}

function stagedCopies() {
  const modules = join(root, 'apps/desktop/dist/helper/node_modules')
  if (!existsSync(modules)) return { available: false }
  const paths = new Set()
  function visitModules(path) {
    if (!existsSync(path)) return
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, item.name)
      if (item.name.startsWith('@') && item.isDirectory()) { visitModules(child); continue }
      if (!item.isDirectory() || !existsSync(join(child, 'package.json'))) continue
      paths.add(realpathSync(child))
      visitModules(join(child, 'node_modules'))
    }
  }
  visitModules(modules)
  const packages = [...paths].map((path) => {
    const manifest = readJson(join(path, 'package.json'))
    return { name: manifest.name, version: manifest.version, path: relative(root, path), bytes: directoryBytes(path) }
  }).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  return { available: true, copies: packages.length, names: new Set(packages.map((row) => row.name)).size, bytes: packages.reduce((sum, row) => sum + row.bytes, 0), packages }
}

function installedCopies() {
  const names = requiredRuntimePackages
  const desktop = join(root, 'apps/desktop')
  const require = createRequire(join(desktop, 'package.json'))
  const seen = new Map()
  const edges = new Map()
  const rootPaths = new Map()
  const missingOptional = new Set()
  function resolvePackage(name, from, optional) {
    for (const dir of from.resolve.paths(name) ?? []) {
      const candidate = join(dir, name)
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    }
    if (optional) { missingOptional.add(name); return null }
    throw new Error(`Missing installed package ${name}`)
  }
  function visit(name, from, optional = false) {
    const path = resolvePackage(name, from, optional)
    if (!path || seen.has(path)) return path
    const manifest = readJson(join(path, 'package.json'))
    const row = { name: manifest.name, version: manifest.version, path: relative(root, path), bytes: directoryBytes(path) }
    seen.set(path, row)
    edges.set(path, new Set())
    const local = createRequire(join(path, 'package.json'))
    for (const dependency of Object.keys({ ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies })) {
      const next = visit(dependency, local, Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) || manifest.peerDependenciesMeta?.[dependency]?.optional === true)
      if (next) edges.get(path).add(next)
    }
    return path
  }
  for (const name of names) rootPaths.set(name, visit(name, require))
  function closure(path) {
    const found = new Set()
    const pending = [path]
    while (pending.length) {
      const next = pending.pop()
      if (found.has(next)) continue
      found.add(next)
      pending.push(...edges.get(next) ?? [])
    }
    return found
  }
  const branches = Object.fromEntries([...rootPaths].map(([name, path]) => {
    const members = closure(path)
    return [name, { copies: members.size, bytes: [...members].reduce((sum, member) => sum + seen.get(member).bytes, 0) }]
  }))
  const copies = [...seen.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  const byName = Object.groupBy(copies, (row) => row.name)
  const platformDirectories = {}
  for (const row of copies) {
    if (!['node-pty', '@anthropic-ai/claude-agent-sdk-darwin-arm64', '@vscode/ripgrep'].includes(row.name)) continue
    const path = resolve(root, row.path)
    const subpath = row.name === 'node-pty' ? join(path, 'prebuilds') : path
    platformDirectories[row.name] = Object.fromEntries(readdirSync(subpath, { withFileTypes: true })
      .filter((item) => item.isDirectory() && item.name !== 'node_modules')
      .map((item) => [item.name, directoryBytes(join(subpath, item.name))]))
  }
  return {
    roots: names, copies: copies.length, names: Object.keys(byName).length,
    bytes: copies.reduce((sum, row) => sum + row.bytes, 0),
    missingOptional: [...missingOptional].sort(), branches, platformDirectories, packages: copies,
  }
}

async function valueImports() {
  const ts = createRequire(join(root, 'tools/arch/package.json'))('typescript')
  const areas = [
    'plugins/workflows/src/server',
    'plugins/agents/src/client',
  ]
  const output = {}
  for (const area of areas) {
    const areaRoot = join(root, area)
    const configPath = ts.findConfigFile(areaRoot, ts.sys.fileExists, 'tsconfig.json')
    if (!configPath) throw new Error(`No tsconfig for ${area}`)
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath))
    const files = parsed.fileNames.filter((path) => path.startsWith(areaRoot) && !/\.test\./.test(path))
    const edges = new Map(files.map((path) => [resolve(path), new Set()]))
    let typeOnly = 0
    let dynamic = 0
    const dynamicEdges = []
    const unresolved = []
    for (const path of files) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function add(specifier, kind) {
        if (!specifier.startsWith('.')) return
        if (kind === 'type') typeOnly++
        if (kind === 'dynamic') dynamic++
        const resolved = ts.resolveModuleName(specifier, path, parsed.options, ts.sys).resolvedModule?.resolvedFileName
        if (!resolved) { unresolved.push(`${relative(root, path)} -> ${specifier}`); return }
        if (kind === 'type') return
        const target = resolve(resolved)
        if (kind === 'dynamic') { dynamicEdges.push([relative(root, path), relative(root, target)]); return }
        if (edges.has(target)) edges.get(resolve(path)).add(target)
      }
      function walk(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = ts.isImportDeclaration(node) ? node.importClause : null
          const named = clause?.namedBindings
          const onlyNamedTypes = !clause?.name && named && ts.isNamedImports(named)
            && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly)
          const exported = ts.isExportDeclaration(node) ? node.exportClause : null
          const onlyExportedTypes = exported && ts.isNamedExports(exported)
            && exported.elements.length > 0 && exported.elements.every((element) => element.isTypeOnly)
          const type = node.isTypeOnly || clause?.isTypeOnly || onlyNamedTypes || onlyExportedTypes
          add(node.moduleSpecifier.text, type ? 'type' : 'value')
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text, 'dynamic')
        ts.forEachChild(node, walk)
      }
      walk(source)
    }
    let index = 0
    const indexes = new Map(), low = new Map(), stack = [], onStack = new Set(), components = []
    function connect(path) {
      indexes.set(path, index); low.set(path, index++); stack.push(path); onStack.add(path)
      for (const next of edges.get(path)) {
        if (!indexes.has(next)) { connect(next); low.set(path, Math.min(low.get(path), low.get(next))) }
        else if (onStack.has(next)) low.set(path, Math.min(low.get(path), indexes.get(next)))
      }
      if (low.get(path) !== indexes.get(path)) return
      const component = []
      let item
      do { item = stack.pop(); onStack.delete(item); component.push(relative(root, item)) } while (item !== path)
      if (component.length > 1) components.push(component.sort())
    }
    for (const path of edges.keys()) if (!indexes.has(path)) connect(path)
    const valueEdges = [...edges].flatMap(([from, targets]) => [...targets].map((to) => [relative(root, from), relative(root, to)]))
    output[area] = { files: files.length, valueEdges: valueEdges.length, edges: valueEdges, typeOnly, dynamic, dynamicEdges, unresolved, components }
  }
  return output
}

if (process.argv.includes('--self-test')) {
  const fixture = {
    importers: {
      '.': { dependencies: { a: { version: '1.0.0(peer@1.0.0)' }, b: { version: '1.0.0' }, local: { version: 'link:packages/local' } }, devDependencies: { test: { version: '1.0.0' } } },
    },
    packages: {},
    snapshots: {
      'a@1.0.0(peer@1.0.0)': { dependencies: { shared: '1.0.0', peer: '1.0.0' }, optionalDependencies: { optional: '1.0.0' } },
      'b@1.0.0': { dependencies: { shared: '1.0.0', conflict: '2.0.0' } },
      'test@1.0.0': { dependencies: { conflict: '1.0.0', shared: '1.0.0' } },
      'shared@1.0.0': {}, 'peer@1.0.0': {}, 'optional@1.0.0': {}, 'conflict@1.0.0': {}, 'conflict@2.0.0': {},
    },
  }
  const measured = lockedGraph(fixture)
  assert.deepEqual(measured.unresolved, [])
  assert.equal(measured.closure.production.snapshots, 6)
  assert.equal(measured.closure.developmentOnly.snapshots, 2)
  assert.equal(measured.closure.overlap.snapshots, 1)
  assert.equal(measured.removableByRoot['a@1.0.0(peer@1.0.0)'], 3)
  assert.equal(measured.removableByRoot['b@1.0.0'], 2)
  console.log('Inventory graph fixture passed: peers, optional and workspace edges, overlap, conflicting versions.')
  process.exit(0)
}

const lock = lockMaps()
const result = {
  schema: 1,
  inputs: ['pnpm-lock.yaml', 'apps/*/package.json', 'packages/*/package.json', 'plugins/*/package.json', 'tools/*/package.json', 'installed apps/desktop/node_modules', 'source tsconfigs'],
  target: { platform: process.platform, architecture: process.arch, node: process.version },
  manifests: manifestInventory(lock.importers),
  dependencyGraph: lockedGraph(lock),
  source: sourceCensus(),
  installed: installedCopies(),
  staged: stagedCopies(),
  imports: await valueImports(),
}
if (result.dependencyGraph.unresolved.length || Object.values(result.imports).some((area) => area.unresolved.length)) {
  console.error('Inventory has unresolved graph nodes; see the unresolved arrays in output.')
  process.exitCode = 1
}
console.log(JSON.stringify(result, null, 2))
