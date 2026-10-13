import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { WebDriverClient } from './webdriver.mjs'
import { stageTestApp } from './nativeApp.mjs'
import { parseAgentSessionOptions } from './options.mjs'
import {
  desktopRoot,
  manifestPath,
  processIsAlive,
  readJson,
  repoRoot,
  sessionDirectory,
  writePrivateJson,
} from './state.mjs'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'

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

/** Run a command and hand back its stdout, still showing its stderr. */
function capture(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], env: process.env })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun(out)
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

async function installReplayHarness(dataDir) {
  const target = join(dataDir, 'plugins', 'streaming-replay')
  await mkdir(target, { recursive: true, mode: 0o700 })
  await Promise.all(['replay-agent.mjs', 'replay-fixtures.mjs'].map((name) =>
    copyFile(join(import.meta.dirname, name), join(target, name))))
  await writeFile(join(target, 'acorn-plugin.json'), JSON.stringify({
    id: 'streaming-replay', name: 'Streaming replay', version: '1.0.0', baseline: 'acorn-1', apiVersion: '5',
    contributions: { harnesses: [{ id: 'replay', label: 'Replay', spawn: { entry: './replay-agent.mjs' } }] },
  }))
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
  const welcome = await waitForText(client, 'Welcome to acorn')
  const start = welcome.elements.find((element) => element.name === 'Get started')
  if (!start) throw new Error('The onboarding screen has no Get started button.')
  await client.click(await client.resolveElement(start.ref))
  await waitForText(client, 'Add your first project')
  const screenshot = join(directory, 'screenshots', 'smoke.png')
  await client.screenshot(screenshot)
  console.log(`Agent automation smoke test passed. Screenshot: ${screenshot}`)
}

async function main() {
  const options = parseAgentSessionOptions(process.argv.slice(2))
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
  let fixture = null
  let previous = null

  if (await exists(directory)) {
    try { previous = await readJson(manifestFile) } catch {}
    if (previous && processIsAlive(previous.launcherPid)) throw new Error(`Agent session ${name} is already running.`)
    if (!options.reuse) throw new Error(`Agent session ${name} already exists. Choose another name or pass --reuse to keep its data.`)
    if (options.workspaces && previous?.workspaces !== options.workspaces) throw new Error('This session was seeded with different --workspaces options. Choose a new session name.')
  }

  await mkdir(logDir, { recursive: true, mode: 0o700 })
  await writePrivateJson(manifestFile, { name, status: 'starting', launcherPid: process.pid, directory, dataDir })

  try {
    if (!options.onboarding) {
      const project = await stat(options.project)
      if (!project.isDirectory()) throw new Error(`Project path is not a directory: ${options.project}`)
    }

    if (!options.prepared) {
      console.log(`[agent-dev:${name}] staging desktop assets`)
      await run(pnpm, ['run', 'stage'], desktopRoot)
      await run(pnpm, ['run', 'build:renderer'], desktopRoot)
      console.log(`[agent-dev:${name}] building the automation-only debug binary`)
      await run(cargo, ['build', '--manifest-path', join(desktopRoot, 'src-tauri', 'Cargo.toml'), '--features', 'agent-automation'], repoRoot)
    }

    if (options.fixture && options.reuse && previous?.fixture) {
      // A reused session keeps the fixture it was generated with, data and repository both.
      if (options.telemetry && previous.fixture.telemetry !== options.telemetry)
        throw new Error('This session was seeded with a different --telemetry mode. Choose a new session name.')
      fixture = previous.fixture
      options.project = fixture.project
    } else if (options.fixture) {
      // The fixture's repository lives in the session directory, beside the data it seeds, and is
      // generated fresh from the profile and seed (docs/testing/desktop.md § The large-surface fixture).
      const project = join(directory, 'fixture', 'repo')
      console.log(`[agent-dev:${name}] generating the ${options.fixture} fixture (${options.profile}, seed ${options.seed})`)
      const out = await capture(pnpm, ['exec', 'tsx', 'scripts/agent/seed.ts', '--data-dir', dataDir, '--project', project,
        '--fixture', options.fixture, '--profile', options.profile, '--seed', String(options.seed),
        ...(options.telemetry ? ['--telemetry', options.telemetry] : []),
        ...(options.workspaces ? ['--workspaces', options.workspaces] : [])], desktopRoot)
      const seeded = JSON.parse(out.trim().split('\n').at(-1))
      fixture = { name: options.fixture, project, ...seeded }
      delete fixture.fixture
      options.project = project
    } else if (!options.onboarding) {
      console.log(`[agent-dev:${name}] adding ${options.project}`)
      await run(pnpm, ['exec', 'tsx', 'scripts/agent/seed.ts', '--data-dir', dataDir, '--project', options.project,
        ...(options.workspaces ? ['--workspaces', options.workspaces] : [])], desktopRoot)
    }

    if (options.fixture === 'streaming-replay') await installReplayHarness(dataDir)

    let viteUrl = null
    if (options.vite) {
      const vitePort = await freePort()
      vite = await createViteServer({
        configFile: join(desktopRoot, 'vite.config.ts'),
        server: { host: '127.0.0.1', port: vitePort, strictPort: true },
      })
      await vite.listen()
      viteUrl = `http://127.0.0.1:${vitePort}`
    }

    const webdriverPort = await freePort()
    const endpoint = `http://127.0.0.1:${webdriverPort}`
    const built = join(desktopRoot, 'src-tauri', 'target', 'debug', `acorn-desktop${process.platform === 'win32' ? '.exe' : ''}`)
    // On macOS the window runs from a test app bundle, so native tools see one stable identity for
    // every session and a path of its own for this one (./nativeApp.mjs).
    const nativeApp = process.platform === 'darwin' ? await stageTestApp(directory, built) : null
    const executable = nativeApp?.executable ?? built
    log = createWriteStream(join(logDir, 'desktop.log'), { flags: 'a', mode: 0o600 })
    app = spawn(executable, [], {
      cwd: desktopRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ACORN_DATA_DIR: dataDir,
        ACORN_DEV_SERVER: viteUrl ?? '',
        // Leave the person's own `acorn-dev` MCP registration alone (plugins/terminal/src/server/terminal.ts).
        ACORN_SKIP_MCP_REGISTRATION: '1',
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
      fixture,
      workspaces: options.workspaces,
      viteUrl,
      webdriverEndpoint: endpoint,
      webdriverSessionId: driver.sessionId,
      nativeApp,
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
      fixture,
      workspaces: options.workspaces,
      stoppedAt: new Date().toISOString(),
    })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
