import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { extname, join, resolve } from 'node:path'

const roots = [
  resolve(import.meta.dirname, '../out/main'),
  resolve(import.meta.dirname, '../out/preload'),
]

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? javascriptFiles(path) : [path]
  }))
  return nested.flat()
}

const files = (await Promise.all(roots.map(javascriptFiles)))
  .flat()
  .filter((path) => ['.cjs', '.js', '.mjs'].includes(extname(path)))
  .sort()

if (files.length === 0) throw new Error('No Electron runtime bundles were found to validate')

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status === 0) continue
  if (result.stdout) process.stderr.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  throw new Error(`Generated runtime bundle has invalid syntax: ${file}`)
}

console.log(`[runtime-syntax] checked ${files.length} generated JavaScript files`)
