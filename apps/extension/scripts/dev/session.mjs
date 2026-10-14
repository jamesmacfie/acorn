import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { build } from 'vite'
import {
  BROWSER_BRIDGE_DEV_HOST,
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
} from '@acorn/protocol/extensionBridge.ts'
import {
  FIREFOX_DEV_UUID,
  extensionRoot,
  parseSessionOptions,
  processIsAlive,
  readJson,
  repoRoot,
  sessionDirectory,
  writePrivateJson,
} from './state.mjs'

// `pnpm dev:extension -- --browser chrome|firefox --session NAME [--node https://HOST:PORT]`
//
// Builds the extension in watch mode, registers a development native host that runs this checkout's
// CLI build, starts an isolated Node unless --node names one, and opens the browser on its own
// profile through web-ext, which reloads the extension after each rebuild. Ctrl-C, or the driver's
// `stop`, removes the registration and stops everything it started.

const options = parseSessionOptions(process.argv.slice(2))
const { browser } = options
const directory = sessionDirectory(options.session)
const manifestFile = join(directory, 'session.json')
const log = (line) => console.log(`[extension:${options.session}] ${line}`)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const cli = join(repoRoot, 'apps/cli/bin/acorn.mjs')

// The session acts for the person at this checkout, not for an Acorn task, so task credentials in
// the environment must not reach the CLI or the Node.
const env = { ...process.env, ACORN_SKIP_MCP_REGISTRATION: '1' }
delete env.ACORN_TASK_ID
delete env.ACORN_API_TOKEN

const paths = {
  extension: join(directory, 'extension'),
  profile: join(directory, `${browser}-profile`),
  bridge: join(directory, `bridge-${browser}`),
  node: join(directory, 'node'),
  logs: join(directory, 'logs'),
}
// Chrome started on its own profile reads registrations from inside it, so the development host
// never touches the user-level folder. Firefox reads only the user-level folder.
const registryDir =
  browser === 'chrome'
    ? join(paths.profile, 'NativeMessagingHosts')
    : join(homedir(), 'Library/Application Support/Mozilla/NativeMessagingHosts')
const hostFlags = ['--browser', browser, '--development', '--bridge-dir', paths.bridge, '--registry-dir', registryDir]

const children = new Set()
let watcher = null
let stopping = null
// Set once this launcher owns the session folder and its registration. Before that, a failure
// leaves everything as it found it.
let owned = false

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`${label} exited with ${code}.`))))
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(check, timeoutMs, failure) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(failure)
}

// One Firefox development registration exists per user. Refuse to take it from a live session.
async function claimFirefoxRegistration() {
  const registration = join(registryDir, `${BROWSER_BRIDGE_DEV_HOST}.json`)
  if (!existsSync(registration)) return
  const owner = dirname(dirname(JSON.parse(readFileSync(registration, 'utf8')).path ?? ''))
  if (owner === directory) return
  const manifest = await readJson(join(owner, 'session.json')).catch(() => null)
  if (manifest && manifest.status !== 'stopped' && processIsAlive(manifest.launcherPid))
    throw new Error(`The Firefox development host belongs to the running session in ${owner}. Stop it first.`)
}

async function startNode() {
  if (!options.reuse || !existsSync(join(paths.node, 'core.sqlite'))) {
    log('seeding an isolated Node with this checkout as a project')
    await run(pnpm, ['--filter', '@acorn/desktop', 'exec', 'node', '--import', 'tsx', 'scripts/agent/seed.ts',
      '--data-dir', paths.node, '--project', repoRoot], 'Seeding the Node')
  }
  const nodeLog = createWriteStream(join(paths.logs, 'node.log'), { flags: 'a', mode: 0o600 })
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/entries/standalone.ts'], {
    cwd: join(repoRoot, 'apps/node'),
    env: { ...env, ACORN_DATA_DIR: paths.node },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  child.stderr.pipe(nodeLog)
  return new Promise((resolve, reject) => {
    let handshake = null
    const timer = setTimeout(() => reject(new Error('The Node did not start within 120 seconds. See logs/node.log.')), 120_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (!handshake) reject(new Error(`The Node exited with ${code} before it was ready. See logs/node.log.`))
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      // The first line is the launcher handshake. It carries a device token, so it is never printed.
      if (!handshake) {
        handshake = JSON.parse(line)
        clearTimeout(timer)
        resolve({ pid: child.pid, nodeId: handshake.nodeId, endpoint: handshake.endpoint })
        return
      }
      nodeLog.write(`${line}\n`)
      if (line.trim()) console.log(`[node] ${line}`)
    })
  })
}

async function startWatchBuild() {
  await rm(paths.extension, { recursive: true, force: true })
  process.env.ACORN_EXTENSION_HOST = 'development'
  watcher = await build({
    configFile: join(extensionRoot, 'vite.config.ts'),
    mode: browser,
    logLevel: 'warn',
    // Not emptied between rebuilds, so web-ext never reloads a half-written folder.
    build: { outDir: paths.extension, emptyOutDir: false, watch: {} },
  })
  await new Promise((resolve, reject) => {
    const first = (event) => {
      if (event.code === 'END') {
        watcher.off('event', first)
        resolve()
      } else if (event.code === 'ERROR') reject(event.error)
    }
    watcher.on('event', first)
  })
  watcher.on('event', (event) => {
    if (event.code === 'END') log('rebuilt; web-ext reloads the extension')
    if (event.code === 'ERROR') log(`build failed: ${event.error.message}`)
  })
}

function startBrowser(port) {
  const webExt = join(extensionRoot, 'node_modules/web-ext/bin/web-ext.js')
  const args =
    browser === 'chrome'
      ? ['run', '--target', 'chromium', '--chromium-profile', paths.profile, '--keep-profile-changes',
          `--args=--remote-debugging-port=${port}`,
          ...(options.browserBinary ? ['--chromium-binary', options.browserBinary] : [])]
      : ['run', '--target', 'firefox-desktop', '--firefox-profile', paths.profile, '--profile-create-if-missing',
          '--keep-profile-changes', `--arg=--remote-debugging-port=${port}`,
          `--pref=extensions.webextensions.uuids=${JSON.stringify({ [FIREFOX_EXTENSION_ID]: FIREFOX_DEV_UUID })}`,
          ...(options.browserBinary ? ['--firefox', options.browserBinary] : [])]
  const child = spawn(process.execPath, [webExt, ...args, '--source-dir', paths.extension, '--no-input'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  const webExtLog = createWriteStream(join(paths.logs, 'web-ext.log'), { flags: 'a', mode: 0o600 })
  child.stderr.pipe(webExtLog)
  // web-ext rewrites its reload line in place with a bare carriage return, so split on either.
  let partial = ''
  child.stdout.on('data', (chunk) => {
    const lines = (partial + chunk).split(/\r\n|\r|\n/)
    partial = lines.pop()
    for (const line of lines.filter((entry) => entry.trim())) {
      webExtLog.write(`${line}\n`)
      if (/reload|error|running/i.test(line)) console.log(`[web-ext] ${line.trim()}`)
    }
  })
  child.once('exit', (code) => {
    children.delete(child)
    if (!stopping) {
      log(`web-ext exited with ${code}; stopping the session`)
      void stop(code === 0 ? 0 : 1)
    }
  })
  return child
}

const automationReady = (port) =>
  browser === 'chrome'
    ? fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.ok)
    : fetch(`http://127.0.0.1:${port}/`).then((response) => response.ok)

function stopChild(child, signal, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill(signal)
  })
}

async function stop(code) {
  stopping ??= (async () => {
    log('stopping')
    await watcher?.close()
    for (const child of children) await stopChild(child, 'SIGINT', 40_000)
    await run(process.execPath, [cli, 'browser', 'uninstall', ...hostFlags], 'Removing the development host').catch(
      (error) => log(`could not remove the development host: ${error.message}`),
    )
    const manifest = await readJson(manifestFile).catch(() => ({}))
    await writePrivateJson(manifestFile, { ...manifest, status: 'stopped', stoppedAt: new Date().toISOString() })
    log('stopped')
    process.exit(code)
  })()
  return stopping
}

async function main() {
  const previous = await readJson(manifestFile).catch(() => null)
  if (previous && !options.reuse) throw new Error(`Session ${options.session} exists. Pass --reuse or choose another name.`)
  if (previous?.status !== 'stopped' && processIsAlive(previous?.launcherPid))
    throw new Error(`Session ${options.session} is already running.`)
  if (previous?.browser && previous.browser !== browser)
    throw new Error(`Session ${options.session} was a ${previous.browser} session. Choose another name.`)
  await mkdir(paths.logs, { recursive: true, mode: 0o700 })
  if (browser === 'chrome') await mkdir(paths.profile, { recursive: true, mode: 0o700 })
  else await claimFirefoxRegistration()
  await writePrivateJson(manifestFile, { name: options.session, browser, status: 'starting', launcherPid: process.pid, directory })
  owned = true
  process.once('SIGINT', () => void stop(0))
  process.once('SIGTERM', () => void stop(0))

  log('building the CLI for the native host')
  await run(pnpm, ['--filter', '@acorn/cli', 'build'], 'Building the CLI')
  const installed = JSON.parse(
    await run(process.execPath, [cli, 'browser', 'install', ...hostFlags, '--output', 'json'], 'Registering the host'),
  )[0]
  log(`registered ${installed.hostName} at ${installed.registration}`)

  const node = options.node ? { endpoint: options.node } : await startNode()
  // The browser hands its environment to the native host, which then finds this session's Node as the
  // Node on this computer, the way `acorn` would with the same variable.
  if (node.pid) env.ACORN_DATA_DIR = paths.node
  await startWatchBuild()
  const port = await freePort()
  startBrowser(port)
  await waitFor(() => automationReady(port), 60_000, `${browser} opened no automation endpoint on port ${port}. See logs/web-ext.log.`)

  const origin = browser === 'chrome' ? `chrome-extension://${CHROME_EXTENSION_ID}` : `moz-extension://${FIREFOX_DEV_UUID}`
  await writePrivateJson(manifestFile, {
    name: options.session,
    browser,
    status: 'ready',
    launcherPid: process.pid,
    directory,
    extension: { dir: paths.extension, origin, sidebarUrl: `${origin}/sidebar.html` },
    automation:
      browser === 'chrome'
        ? { protocol: 'cdp', endpoint: `http://127.0.0.1:${port}` }
        : { protocol: 'webdriver-bidi', endpoint: `ws://127.0.0.1:${port}/session` },
    nativeHost: { name: installed.hostName, registration: installed.registration, launcher: installed.launcher },
    bridgeDir: paths.bridge,
    profileDir: paths.profile,
    node,
    logs: paths.logs,
  })
  log(`ready. Pair ${node.endpoint} from the sidebar.`)
  if (node.pid) log(`a pairing code: pnpm dev:extension:ui -- --session ${options.session} pairing-code`)
  log(`drive it with: pnpm dev:extension:ui -- --session ${options.session} open`)
}

main().catch(async (error) => {
  console.error(`[extension:${options.session}] ${error.message}`)
  if (owned) await stop(1)
  else process.exit(1)
})
