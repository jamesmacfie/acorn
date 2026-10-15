import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT } from './docAnchors.ts'

// Who imports each name in the `@acorn/plugin-api` facade. The names come from the facade's surface
// snapshot, which `surface.test.ts` keeps exact. A consumer is a workspace folder such as
// `plugins/agents` or `apps/tui`, and its tests count. `facadeConsumers.test.ts` uses this to keep
// every name imported. Run `node tools/arch/facadeConsumers.ts` for the counts and each export's
// consumers.

const SNAPSHOT = join(ROOT, 'packages/plugin-api/src/surface.snapshot.txt')
const SPEC = String.raw`['"]@acorn/plugin-api(?:/([^'"]+))?['"]`

// `import { a, type B as C } from`, `import D, { a } from`, and `export { a } from`.
const NAMED_RE = new RegExp(
  String.raw`\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*` + SPEC,
  'g',
)
// `import * as ns from`, then every `ns.name` in the file.
const NAMESPACE_RE = new RegExp(String.raw`\bimport\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*` + SPEC, 'g')
// `const { a } = await import(…)` and `import(…).then(({ a }) =>`.
const AWAITED_RE = new RegExp(String.raw`\{([^}]*)\}\s*=\s*await\s+import\(\s*` + SPEC + String.raw`\s*\)`, 'g')
const THEN_RE = new RegExp(String.raw`\bimport\(\s*` + SPEC + String.raw`\s*\)\.then\(\s*\(\s*\{([^}]*)\}`, 'g')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'target'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.(?:tsx?|mts|mjs|jsx?)$/.test(entry.name)) out.push(path)
  }
  return out
}

// The imported side of each binding: `a`, `type a`, `a as b`, and `a: b` all name `a`.
function importedNames(list: string): string[] {
  return list
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+|\s*:\s*/)[0]
        .trim(),
    )
    .filter(Boolean)
}

function consumerOf(file: string): string {
  const [top, name] = relative(ROOT, file).split('/')
  return top === 'scripts' ? top : `${top}/${name}`
}

/** Every facade export, as `entry: name`, mapped to the workspace folders that import it. */
export function facadeConsumers(): Map<string, Set<string>> {
  const consumers = new Map<string, Set<string>>()
  for (const line of readFileSync(SNAPSHOT, 'utf8').trim().split('\n').slice(1)) consumers.set(line, new Set())
  const use = (entry: string | undefined, name: string, consumer: string) =>
    consumers.get(`${entry ?? ''}: ${name}`)?.add(consumer)

  const facade = join(ROOT, 'packages/plugin-api')
  const files = ['apps', 'packages', 'plugins', 'scripts', 'tools']
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((file) => !file.startsWith(facade + '/'))
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('@acorn/plugin-api')) continue
    const consumer = consumerOf(file)
    for (const [, list, entry] of source.matchAll(NAMED_RE)) {
      for (const name of importedNames(list)) use(entry, name, consumer)
    }
    for (const [, list, entry] of source.matchAll(AWAITED_RE)) {
      for (const name of importedNames(list)) use(entry, name, consumer)
    }
    for (const [, entry, list] of source.matchAll(THEN_RE)) {
      for (const name of importedNames(list)) use(entry, name, consumer)
    }
    for (const [, namespace, entry] of source.matchAll(NAMESPACE_RE)) {
      for (const [, name] of source.matchAll(new RegExp(String.raw`\b${namespace}\.([\w$]+)`, 'g'))) {
        use(entry, name, consumer)
      }
    }
  }
  return consumers
}

if (import.meta.main) {
  const consumers = facadeConsumers()
  const buckets = ['None', 'One', 'Two', 'Three or more']
  const counts = [0, 0, 0, 0]
  for (const users of consumers.values()) counts[Math.min(users.size, 3)]++
  console.log('| Consumers | Exports |\n| --- | --- |')
  buckets.forEach((bucket, i) => console.log(`| ${bucket} | ${counts[i]} |`))
  console.log('')
  for (const [name, users] of consumers) console.log(`${users.size}\t${name}\t${[...users].sort().join(' ')}`)
}
