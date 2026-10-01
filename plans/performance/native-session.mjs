// Test launcher for an already-built automation bundle. Production launching stays in scripts/agent.
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { PerformanceDriver } from './native-driver.mjs'
import { desktopRoot, manifestPath, processIsAlive, readJson, sessionDirectory, validateSessionName, writePrivateJson } from '../../apps/desktop/scripts/agent/state.mjs'

const name = validateSessionName(process.argv[2] ?? '')
if (!name.startsWith('perf-')) throw new Error('Use a perf- test session name.')
const executable = resolve(process.argv[3] ?? '')
if (!(await stat(executable)).isFile()) throw new Error('Automation executable is missing.')
const project = '/tmp/acorn-performance-fixture'
if (!(await stat(project)).isDirectory()) throw new Error('Disposable project is missing.')
const directory = sessionDirectory(name)
const dataDir = join(directory, 'data')
const logDir = join(directory, 'logs')
let previous = null
try { previous = await readJson(manifestPath(name)) } catch {}
if (previous && processIsAlive(previous.launcherPid)) throw new Error('Test session is running.')
await mkdir(logDir, { recursive: true, mode: 0o700 })
const log = createWriteStream(join(logDir, 'desktop.log'), { flags: 'a', mode: 0o600 })
let app = null
let driver = null
let status = 'failed'

function runSeed() {
  return new Promise((resolveRun, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'scripts/agent/seed.ts', '--data-dir', dataDir, '--project', project], {
      cwd: desktopRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`Test seed exited ${code}.`)))
  })
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

await writePrivateJson(manifestPath(name), { name, status: 'starting', launcherPid: process.pid, directory, dataDir })
try {
  if (!previous) await runSeed()
  const port = await freePort()
  const endpoint = `http://127.0.0.1:${port}`
  app = spawn(executable, [], {
    cwd: desktopRoot, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ACORN_DATA_DIR: dataDir, ACORN_DEV_SERVER: '', TAURI_WEBDRIVER_PORT: String(port) },
  })
  const exited = new Promise((resolveExit) => app.once('exit', resolveExit))
  await new Promise((resolveSpawn, reject) => {
    app.once('spawn', resolveSpawn)
    app.once('error', reject)
  })
  app.stdout.pipe(log, { end: false })
  app.stderr.pipe(log, { end: false })
  driver = new PerformanceDriver(endpoint)
  await driver.waitUntilReady()
  await driver.createSession()
  await writePrivateJson(manifestPath(name), {
    name, status: 'ready', launcherPid: process.pid, appPid: app.pid, directory, dataDir,
    project, viteUrl: null, webdriverEndpoint: endpoint, webdriverSessionId: driver.sessionId,
    startedAt: new Date().toISOString(), executable,
  })
  console.log(`${name} ready; isolated automation bundle, no normal profile.`)
  await Promise.race([exited, new Promise((resolveStop) => {
    process.once('SIGINT', resolveStop)
    process.once('SIGTERM', resolveStop)
  })])
  status = 'stopped'
} finally {
  await driver?.deleteSession().catch(() => {})
  if (app?.exitCode === null && app?.signalCode === null) {
    app.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => app.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ])
    if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL')
  }
  log.end()
  await writePrivateJson(manifestPath(name), { name, status, launcherPid: process.pid, directory, dataDir, stoppedAt: new Date().toISOString() })
}
