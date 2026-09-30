import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { sha256 } from './node-runtime.mjs'

const trees = [
  ['client', 'client'], ['bridge', 'bridge'], ['helper', 'helper'],
  ['cli', 'cli'], ['bundled-plugins', 'plugins'],
]
const required = [
  'client/index.html', 'bridge/bridge.js', 'bridge/plugin-frame.css',
  'helper/helper.js', 'helper/service.js', 'helper/mcp.js', 'helper/package.json',
  'cli/cli.js', 'cli/package.json', 'helper/migrations/meta/_journal.json',
]

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? filesUnder(path) : [path]
})

// Both installer formats must carry every staged resource, including runtime dependencies.
export function verifyResources(pkg, resources, fail) {
  for (const [sourceName, targetName] of trees) {
    const source = resolve(pkg, 'dist', sourceName)
    const target = join(resources, targetName)
    if (!existsSync(source)) { fail(`${sourceName}: was never staged.`); continue }
    if (!existsSync(target)) { fail(`${targetName}: is missing from the bundle.`); continue }
    const staged = filesUnder(source)
    if (staged.length === 0) fail(`${sourceName}: the staged directory is empty.`)
    for (const file of staged) {
      const packaged = join(target, relative(source, file))
      if (!existsSync(packaged)) fail(`missing ${relative(resources, packaged)}.`)
      else if (sha256(file) !== sha256(packaged)) fail(`packaged bytes differ: ${relative(resources, packaged)}.`)
    }
    console.log(`[verify] ${targetName}: checked ${staged.length} files`)
  }
  for (const file of required) {
    if (!existsSync(join(resources, file))) fail(`the bundle is missing ${file}.`)
  }
  const pluginRoot = join(resources, 'plugins')
  const plugins = existsSync(pluginRoot) ? readdirSync(pluginRoot) : []
  if (plugins.length === 0) fail('the bundle ships no bundled plugins.')
  for (const plugin of plugins) {
    if (!existsSync(join(pluginRoot, plugin, 'acorn-plugin.json'))) fail(`bundled plugin ${plugin} has no acorn-plugin.json.`)
  }
}

export function verifyRuntime(node, pkg, execFileSync, fail) {
  if (!existsSync(node)) return fail(`the bundled Node runtime is missing: ${node}.`)
  const version = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim()
  const pin = `v${JSON.parse(readFileSync(resolve(pkg, '../../node-runtime.json'), 'utf8')).version}`
  if (version !== pin) fail(`the bundled runtime reports ${version} and node-runtime.json pins ${pin}.`)
  else console.log(`[verify] node runtime: ${version}`)
}
