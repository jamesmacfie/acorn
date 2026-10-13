import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

// Where a `pnpm dev:extension` session keeps its things, and the manifest that tells the driver
// how to reach it. Shaped like the desktop and terminal agent drivers (docs/local-development/agent-drivers.md).

export const repoRoot = resolve(import.meta.dirname, '../../../..')
export const extensionRoot = resolve(import.meta.dirname, '../..')
const sessionsRoot = join(repoRoot, '.acorn', 'extension-dev')

// Firefox gives each extension a random internal UUID per profile. The session pins it, so the
// sidebar address in the manifest is stable.
export const FIREFOX_DEV_UUID = '7d3c2f0e-4a1b-4c6d-9e8f-a0c0e0000001'

function validateSessionName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))
    throw new Error('Session names must be 1-64 letters, digits, dots, underscores, or hyphens, starting with a letter or digit.')
  return name
}

export const sessionDirectory = (name) => join(sessionsRoot, validateSessionName(name))
const manifestPath = (name) => join(sessionDirectory(name), 'session.json')

export function parseSessionOptions(argv) {
  const options = { browser: null, session: null, node: null, reuse: false, browserBinary: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--browser') options.browser = argv[++index] ?? ''
    else if (arg === '--session') options.session = validateSessionName(argv[++index] ?? '')
    else if (arg === '--node') options.node = argv[++index] ?? ''
    else if (arg === '--browser-binary') options.browserBinary = resolve(argv[++index] ?? '')
    else if (arg === '--reuse') options.reuse = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.browser !== 'chrome' && options.browser !== 'firefox') throw new Error('Pass --browser chrome or --browser firefox.')
  if (!options.session) throw new Error('Pass --session NAME.')
  if (options.node !== null) {
    let url
    try { url = new URL(options.node) } catch { throw new Error('--node must be an https:// Node address.') }
    if (url.protocol !== 'https:') throw new Error('--node must be an https:// Node address.')
    options.node = url.origin
  }
  return options
}

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

// The running session the driver should act on: the named one, or the only one.
export async function runningManifest(name) {
  const names = name ? [validateSessionName(name)] : await readdir(sessionsRoot).catch(() => [])
  const running = []
  for (const candidate of names) {
    const manifest = await readJson(manifestPath(candidate)).catch(() => null)
    if (manifest?.status === 'ready' && processIsAlive(manifest.launcherPid)) running.push(manifest)
  }
  if (running.length === 1) return running[0]
  if (name) throw new Error(`Extension session ${name} is not running.`)
  if (!running.length) throw new Error('No extension session is running. Start one with pnpm dev:extension.')
  throw new Error(`More than one extension session is running: ${running.map((entry) => entry.name).join(', ')}. Pass --session NAME.`)
}
