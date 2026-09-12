import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { join, resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { WebDriverClient } from './webdriver.mjs'
import {
  desktopRoot,
  manifestPath,
  processIsAlive,
  readJson,
  repoRoot,
  sessionDirectory,
  validateSessionName,
  writePrivateJson,
} from './state.mjs'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'

function parseArgs(argv) {
  const options = { session: null, project: repoRoot, onboarding: false, reuse: false, smoke: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--session') options.session = validateSessionName(argv[++index] ?? '')
    else if (arg === '--project') options.project = resolve(argv[++index] ?? '')
    else if (arg === '--onboarding') options.onboarding = true
    else if (arg === '--reuse') options.reuse = true
    else if (arg === '--smoke') options.smoke = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.onboarding && argv.includes('--project')) throw new Error('Use either --onboarding or --project, not both.')
  if (options.smoke) options.onboarding = true
  return options
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}.`))
    })
  })
}

function waitForSpawn(child) {
  if (child.pid) return Promise.resolve()
  return new Promise((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn)
    child.once('error', reject)
  })
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function tee(child, log) {
  child.stdout?.on('data', (chunk) => {
    log.write(chunk)
    process.stdout.write(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    log.write(chunk)
    process.stderr.write(chunk)
  })
}

async function waitForText(client, text, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let snapshot = null
  while (Date.now() < deadline) {
    snapshot = await client.snapshot()
    if (snapshot.text.includes(text)) return snapshot
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`The Acorn window did not show "${text}" within ${timeoutMs}ms. Last text: ${snapshot?.text ?? '(none)'}`)
}

async function runSmoke(client, directory) {
  const welcome = await waitForText(client, 'Welcome.')
  const start = welcome.elements.find((element) => element.name === 'Get started')
  if (!start) throw new Error('The onboarding screen has no Get started button.')
  await client.click(await client.resolveElement(start.ref))
  await waitForText(client, 'Add your first project.')
  const screenshot = join(directory, 'screenshots', 'smoke.png')
  await client.screenshot(screenshot)
  console.log(`Agent automation smoke test passed. Screenshot: ${screenshot}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const name = options.session ?? `agent-${randomUUID().slice(0, 8)}`
  const directory = sessionDirectory(name)
  const manifestFile = manifestPath(name)
  const dataDir = join(directory, 'data')
  const logDir = join(directory, 'logs')
  let vite = null
  let app = null
  let log = null
  let driver = null
  let status = 'failed'

  if (await exists(directory)) {
    let previous = null
    try { previous = await readJson(manifestFile) } catch {}
    if (previous && processIsAlive(previous.launcherPid)) throw new Error(`Agent session ${name} is already running.`)
    if (!options.reuse) throw new Error(`Agent session ${name} already exists. Choose another name or pass --reuse to keep its data.`)
  }

  await mkdir(logDir, { recursive: true, mode: 0o700 })
  await writePrivateJson(manifestFile, { name, status: 'starting', launcherPid: process.pid, directory, dataDir })

  try {
    if (!options.onboarding) {
      const project = await stat(options.project)
      if (!project.isDirectory()) throw new Error(`Project path is not a directory: ${options.project}`)
    }

    console.log(`[agent-dev:${name}] staging desktop assets`)
    await run(pnpm, ['run', 'stage'], desktopRoot)
    await run(pnpm, ['run', 'build:renderer'], desktopRoot)
    console.log(`[agent-dev:${name}] building the automation-only debug binary`)
    await run(cargo, ['build', '--manifest-path', join(desktopRoot, 'src-tauri', 'Cargo.toml'), '--features', 'agent-automation'], repoRoot)

    if (!options.onboarding) {
      console.log(`[agent-dev:${name}] adding ${options.project}`)
      await run(pnpm, ['exec', 'tsx', 'scripts/agent/seed.ts', '--data-dir', dataDir, '--project', options.project], desktopRoot)
    }

    const vitePort = await freePort()
    vite = await createViteServer({
      configFile: join(desktopRoot, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: vitePort, strictPort: true },
    })
    await vite.listen()

    const webdriverPort = await freePort()
    const endpoint = `http://127.0.0.1:${webdriverPort}`
    const executable = join(desktopRoot, 'src-tauri', 'target', 'debug', `acorn-desktop${process.platform === 'win32' ? '.exe' : ''}`)
    log = createWriteStream(join(logDir, 'desktop.log'), { flags: 'a', mode: 0o600 })
    app = spawn(executable, [], {
      cwd: desktopRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ACORN_DATA_DIR: dataDir,
        ACORN_DEV_SERVER: `http://127.0.0.1:${vitePort}`,
        TAURI_WEBDRIVER_PORT: String(webdriverPort),
      },
    })
    await waitForSpawn(app)
    tee(app, log)

    driver = new WebDriverClient(endpoint)
    await driver.waitUntilReady()
    await driver.createSession()
    await writePrivateJson(manifestFile, {
      name,
      status: 'ready',
      launcherPid: process.pid,
      appPid: app.pid,
      directory,
      dataDir,
      project: options.onboarding ? null : options.project,
      viteUrl: `http://127.0.0.1:${vitePort}`,
      webdriverEndpoint: endpoint,
      webdriverSessionId: driver.sessionId,
      startedAt: new Date().toISOString(),
    })
    console.log(`[agent-dev:${name}] ready`)
    console.log(`Control it with: pnpm dev:agent:ui -- --session ${name} snapshot`)
    console.log(`Stop it with: pnpm dev:agent:ui -- --session ${name} stop`)

    if (options.smoke) await runSmoke(driver, directory)
    else {
      await new Promise((resolveStop) => {
        process.once('SIGINT', resolveStop)
        process.once('SIGTERM', resolveStop)
        app.once('exit', resolveStop)
      })
    }
    status = 'stopped'
  } finally {
    await driver?.deleteSession()
    if (app?.exitCode === null && app?.signalCode === null) app.kill('SIGTERM')
    await vite?.close()
    log?.end()
    await writePrivateJson(manifestFile, {
      name,
      status,
      launcherPid: process.pid,
      directory,
      dataDir,
      stoppedAt: new Date().toISOString(),
    })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
