import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { extname, join, resolve } from 'node:path'

// The generated host-side bundles, parsed by the runtime that will load them: the desktop helper,
// which runs under the bundled Node, and the bridge the shell injects into the webview.
const roots = ['dist/helper', 'dist/bridge'].map((dir) => resolve(import.meta.dirname, '..', dir))

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

if (files.length === 0) throw new Error(`No generated bundles were found to validate in ${roots.join(', ')}`)

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status === 0) continue
  if (result.stdout) process.stderr.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  throw new Error(`Generated runtime bundle has invalid syntax: ${file}`)
}

console.log(`[runtime-syntax] checked ${files.length} generated JavaScript files`)
