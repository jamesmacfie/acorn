// Building a plugin the way a stranger does: outside the repository, against the packed SDK and types,
// with the build tools npm would fetch. The scaffold's tests and the examples test both use it.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const MODULES = resolve(import.meta.dirname, '../node_modules')

/** tsc from this package's own install, run with the current Node. */
export const TSC = join(MODULES, 'typescript', 'bin', 'tsc')

/** Packs a workspace package from `packages/<name>` and unpacks its tarball at `destination`, so the
 *  test sees the bytes npm would publish and nothing else. */
export function unpackPublishedPackage(name: string, destination: string): void {
  const output = execFileSync('pnpm', ['pack', '--pack-destination', dirname(destination)], {
    cwd: join(REPO, 'packages', name),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tarball = output.trim().split('\n').at(-1)
  if (!tarball?.endsWith('.tgz')) throw new Error(`pnpm pack did not return a tarball: ${output}`)
  mkdirSync(destination, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '--strip-components', '1', '-C', destination])
}

/** Copies `@types/node` out of the workspace store into `modules`, so a type check needs no network.
 *  It's a pnpm-shaped path, which is the one thing here that isn't portable. */
export function copyNodeTypes(modules: string): void {
  const store = join(REPO, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find((name) => name.startsWith('@types+node@'))
  if (!entry) throw new Error('@types/node is not in the pnpm store')
  cpSync(join(store, entry, 'node_modules'), modules, { recursive: true, dereference: true })
}

/** Links a build tool from this package's install into `modules`, standing in for `npm install`. */
export function linkTool(name: string, modules: string): void {
  mkdirSync(modules, { recursive: true })
  symlinkSync(realpathSync(join(MODULES, name)), join(modules, name), 'dir')
}

/** Runs a command in `cwd`, and fails with what it printed, because tsc reports on stdout and the
 *  default message says only "Command failed". */
export function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CI: '1' } })
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string }
    throw new Error(`${[command, ...args].join(' ')}: ${stdout}${stderr || String(error)}`)
  }
}
