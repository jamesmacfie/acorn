import { readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

// Vite bundles workspace packages but leaves third-party imports for Node. Check every emitted
// module, including lazy chunks, so a package missing from this host's runtime dependencies fails
// the build instead of crashing the TUI when Node loads that chunk.
const args = process.argv.slice(2)
const distFlag = args.indexOf('--dist')
const dist = resolve(distFlag === -1 ? resolve(import.meta.dirname, '../dist') : args[distFlag + 1])

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? jsFiles(path) : entry.name.endsWith('.js') ? [path] : []
  })
}

function bareImports(source) {
  const found = new Set()
  // Minified chunks can have many declarations on one line, with no space after `import`.
  for (const match of source.matchAll(/(?:^|[;\n}])\s*(?:import(?!\s*\()|export)\s*(?:[^'";]*?\s*from\s*)?["']([^"']+)["']/g)) found.add(match[1])
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.add(match[1])
  return [...found].filter((id) => !id.startsWith('.') && !isAbsolute(id))
}

const missing = []
const checked = new Set()
for (const file of jsFiles(dist)) {
  for (const id of bareImports(readFileSync(file, 'utf8'))) {
    if (checked.has(id)) continue
    checked.add(id)
    try {
      import.meta.resolve(id)
    } catch {
      missing.push(`${id} (imported by ${file.slice(dist.length + 1)})`)
    }
  }
}

if (missing.length) {
  console.error(`[tui-runtime-imports] Unresolved runtime imports:\n${missing.map((id) => `  ${id}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`[tui-runtime-imports] ${checked.size} external imports resolve`)
}
