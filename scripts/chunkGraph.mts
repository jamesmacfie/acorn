import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

// The chunk graph a Node-side build writes beside its output as `startup-graph.json`, and the one
// reader every check of that output shares: the service budget (apps/node/scripts/check-service-budget.mjs),
// the size report (apps/desktop/scripts/size-report.mjs), and the standalone manifest check
// (scripts/pack-node.mjs). The writers are apps/node/vite.config.ts and apps/tui/startupGraph.ts.
//
// Everything here comes from the bundler's own records, never from the text of the emitted code. That
// is what lets the builds minify: a check that read `import` lines would go blind the day the output
// stopped putting one import on each line (docs/frontend/startup-budget.md § The node service).

export interface ChunkRecord {
  /** Chunks this one imports statically, by file name, and external packages by specifier. */
  imports: string[]
  /** The same, for dynamic `import()`. */
  dynamicImports: string[]
  /** Specifiers its modules load through a require that `createRequire` from node:module made. */
  requires: string[]
  /** Source modules bundled into it, relative to the repository. */
  modules: string[]
  /** Its size as emitted, which the reader checks against the file on disk. */
  bytes: number
}

export interface ChunkGraph {
  entry: string
  /** Chunks loaded before the runtime starts work; the static closure grows from these. */
  roots: string[]
  chunks: Record<string, ChunkRecord>
}

interface BundleChunk {
  type: 'chunk'
  fileName: string
  code: string
  imports: string[]
  dynamicImports: string[]
  modules: Record<string, unknown>
}

interface GraphContext {
  getModuleInfo(id: string): { code: string | null; dynamicallyImportedIds: readonly string[] } | null
  parse(code: string): unknown
}

/** One record per emitted chunk, from a `generateBundle` hook. */
export function describeChunks(
  context: GraphContext,
  bundle: Record<string, BundleChunk | { type: 'asset' }>,
  repo: string,
): Record<string, ChunkRecord> {
  const outputs = Object.values(bundle).filter((output): output is BundleChunk => output.type === 'chunk')
  const bundled = new Set(outputs.flatMap((output) => Object.keys(output.modules)))
  const chunks: Record<string, ChunkRecord> = {}
  for (const output of outputs) {
    // Rolldown leaves an external package out of a chunk's `dynamicImports`, so it comes from the
    // modules' own records. An external keeps its specifier; a module the bundler dropped as unused
    // is in no chunk either, but keeps its file path.
    const dynamicImports = new Set(output.dynamicImports)
    const requires = new Set<string>()
    for (const id of Object.keys(output.modules)) {
      const info = context.getModuleInfo(id)
      for (const imported of info?.dynamicallyImportedIds ?? []) {
        if (!bundled.has(imported) && !isAbsolute(imported) && !imported.startsWith('\0')) dynamicImports.add(imported)
      }
      if (info?.code?.includes('createRequire')) for (const specifier of requiredSpecifiers(context.parse(info.code))) requires.add(specifier)
    }
    chunks[output.fileName] = {
      imports: output.imports,
      dynamicImports: [...dynamicImports],
      requires: [...requires].sort(),
      // A virtual module such as `\0rolldown/runtime.js` keeps its own name.
      modules: Object.keys(output.modules).map((id) => id.startsWith('\0') ? id.slice(1) : relative(repo, id.replace(/\?.*$/, ''))),
      bytes: Buffer.byteLength(output.code),
    }
  }
  return chunks
}

// The bundler's ESTree, walked without its types: only a few node shapes matter here.
type AstNode = Record<string, any>

const walk = (node: unknown, visit: (node: AstNode) => void): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node as AstNode)
  for (const child of Object.values(node)) walk(child, visit)
}

/**
 * The string specifiers one module passes to a require made by `createRequire`, in the three shapes
 * the source uses: `createRequire(url)('x')`, `const r = createRequire(url); r('x')`, and
 * `r.resolve('x')`. Read from the module before bundling, so its local names are still the ones the
 * source wrote, whatever the minifier later calls them.
 */
export function requiredSpecifiers(program: unknown): string[] {
  const nodes: AstNode[] = []
  walk(program, (node) => nodes.push(node))
  const makers = new Set(nodes
    .filter((node) => node.type === 'ImportDeclaration' && ['node:module', 'module'].includes(node.source.value))
    .flatMap((node) => node.specifiers)
    .filter((specifier) => specifier.imported?.name === 'createRequire')
    .map((specifier) => specifier.local.name))
  const isMade = (node: AstNode | undefined) => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && makers.has(node.callee.name)
  const requires = new Set(nodes
    .filter((node) => node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isMade(node.init))
    .map((node) => node.id.name))
  const isRequire = (node: AstNode) => isMade(node) || (node.type === 'Identifier' && requires.has(node.name))
  return nodes.flatMap((node) => {
    if (node.type !== 'CallExpression') return []
    const callee = node.callee.type === 'MemberExpression' && node.callee.property.name === 'resolve' ? node.callee.object : node.callee
    const [argument] = node.arguments
    return isRequire(callee) && argument?.type === 'Literal' && typeof argument.value === 'string' ? [argument.value] : []
  })
}

// Rolldown names a chunk edge by the chunk's file name and an external by its specifier.
const namesChunkFile = (id: string) => id.startsWith('.') || id.endsWith('.js')
const isJavaScript = (file: string) => /\.[cm]?js$/.test(file)
const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : []
})

/**
 * The graph beside a built `dist`, checked against the files there. It is stale when it names a chunk
 * the directory lacks, records a size the file no longer has, or misses a script in a chunk folder it
 * uses; incomplete when an edge names a chunk it has no record for. Only folders the graph already
 * uses are checked, because a worker bundle lands in its own folder and is not a chunk.
 */
export function readChunkGraph(dist: string): ChunkGraph {
  const path = join(dist, 'startup-graph.json')
  const graph = JSON.parse(readFileSync(path, 'utf8')) as ChunkGraph
  const named = new Set(Object.keys(graph.chunks))
  const chunkFolders = new Set([...named].map((file) => dirname(file)).filter((folder) => folder !== '.'))
  const problems: string[] = []
  for (const root of new Set([graph.entry, ...graph.roots])) {
    if (!named.has(root)) problems.push(`does not name its root ${root}`)
  }
  for (const [file, chunk] of Object.entries(graph.chunks)) {
    const onDisk = join(dist, file)
    if (!existsSync(onDisk)) problems.push(`names missing ${file}`)
    else if (statSync(onDisk).size !== chunk.bytes) problems.push(`records ${chunk.bytes} B for ${file}, which has ${statSync(onDisk).size} B`)
    for (const next of [...chunk.imports, ...chunk.dynamicImports]) {
      if (namesChunkFile(next) && !named.has(next)) problems.push(`has ${file} import ${next} without naming it`)
    }
  }
  for (const file of filesUnder(dist).map((full) => relative(dist, full).split(sep).join('/'))) {
    if (isJavaScript(file) && chunkFolders.has(dirname(file)) && !named.has(file)) problems.push(`does not name ${file}`)
  }
  if (problems.length) throw new Error(`${path} is stale: ${problems.join(', ')}. Rebuild it.`)
  return graph
}

/** Every chunk the roots reach through static imports. */
export function staticClosure(graph: ChunkGraph, roots: string[] = graph.roots): Set<string> {
  const closure = new Set<string>()
  const visit = (file: string) => {
    if (closure.has(file) || !graph.chunks[file]) return
    closure.add(file)
    for (const next of graph.chunks[file].imports) visit(next)
  }
  for (const root of roots) visit(root)
  return closure
}

/** Emitted bytes of the given chunks, as recorded and checked against disk by `readChunkGraph`. */
export const chunkBytes = (graph: ChunkGraph, files: Iterable<string>): number =>
  [...files].reduce((sum, file) => sum + graph.chunks[file].bytes, 0)

const builtins = new Set(builtinModules)
const isBuiltin = (id: string) => builtins.has(id) || builtins.has(id.replace(/^node:/, ''))

/**
 * Specifiers the given chunks leave for Node to resolve, builtins aside: imported when the chunk
 * loads, imported on first use, and loaded through `createRequire`.
 */
export function externalSpecifiers(graph: ChunkGraph, files: Iterable<string>) {
  const result = { atLoad: new Set<string>(), onFirstUse: new Set<string>(), required: new Set<string>() }
  const add = (into: Set<string>, ids: string[]) => {
    for (const id of ids) if (!graph.chunks[id] && !isBuiltin(id)) into.add(id)
  }
  for (const file of files) {
    const chunk = graph.chunks[file]
    add(result.atLoad, chunk.imports)
    add(result.onFirstUse, chunk.dynamicImports)
    add(result.required, chunk.requires)
  }
  return result
}

/** `@scope/name/sub/path` -> `@scope/name`, `name/sub` -> `name`. */
export const packageName = (specifier: string): string =>
  specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
