import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, cp, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, isAbsolute } from 'node:path'
import * as pty from 'node-pty'
import { keyBytes } from './keys.mjs'
import { createScreen } from './screen.mjs'
import { manifestPath, processIsAlive, readJson, repoRoot, sessionDirectory, tuiRoot, validateSessionName, writePrivateJson } from './state.mjs'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function dimension(value, label) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 20 || parsed > 500) throw new Error(`${label} must be a whole number from 20 to 500.`)
  return parsed
}

function parseArgs(argv) {
  const options = { session: null, reuse: false, cols: 80, rows: 24, dataDir: null, keyboard: 'kitty', build: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--session') options.session = validateSessionName(argv[++index] ?? '')
    else if (arg === '--reuse') options.reuse = true
    else if (arg === '--cols') options.cols = dimension(argv[++index], 'Columns')
    else if (arg === '--rows') options.rows = dimension(argv[++index], 'Rows')
    else if (arg === '--data-dir') options.dataDir = argv[++index] ?? ''
    else if (arg === '--keyboard') options.keyboard = argv[++index] ?? ''
    else if (arg === '--no-build') options.build = false
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.dataDir !== null && !isAbsolute(options.dataDir)) throw new Error('--data-dir must be absolute.')
  if (!['legacy', 'kitty'].includes(options.keyboard)) throw new Error('--keyboard must be legacy or kitty.')
  return options
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}.`)))
  })
}

async function bodyOf(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1024 * 1024) throw new Error('Command is too large.')
  }
  return JSON.parse(body)
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

const settleInput = () => new Promise((resolveSettle) => setTimeout(resolveSettle, 80))

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const name = options.session ?? `tui-${randomUUID().slice(0, 8)}`
  const directory = sessionDirectory(name)
  const dataDir = options.dataDir ?? join(directory, 'data')
  const configDir = join(directory, 'config')
  const manifestFile = manifestPath(name)
  let previous = null
  try { previous = await readJson(manifestFile) } catch {}
  if (previous && processIsAlive(previous.launcherPid)) throw new Error(`TUI session ${name} is already running.`)
  if (previous && !options.reuse) throw new Error(`TUI session ${name} already exists. Choose another name or pass --reuse to keep its data.`)

  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  await mkdir(join(directory, 'logs'), { recursive: true, mode: 0o700 })

  let status = 'failed'
  let app = null
  let server = null
  let log = null
  let trace = null
  let screen = null
  let exitCode = null
  let exitSignal = null
  let stopRequested = false
  const secret = randomBytes(32).toString('hex')
  const base = { name, directory, dataDir, configDir, launcherPid: process.pid, keyboard: options.keyboard }
  await writePrivateJson(manifestFile, { ...base, status: 'starting', cols: options.cols, rows: options.rows })

  try {
    if (options.build) {
      console.log(`[tui-agent:${name}] building Node and TUI`)
      await run(pnpm, ['rebuild:node'], repoRoot)
      await run(pnpm, ['--filter', '@acorn/node', 'build'], repoRoot)
      await run(pnpm, ['--filter', '@acorn/tui', 'build'], repoRoot)
    } else {
      await stat(join(tuiRoot, 'dist', 'main.js'))
    }

    // The built Node leaves native and child-process packages external. Put its artifact beside
    // desktop's installed runtime dependencies; ESM ignores NODE_PATH when resolving imports.
    const nodeRuntime = join(directory, 'node-runtime')
    await rm(nodeRuntime, { recursive: true, force: true })
    await mkdir(nodeRuntime, { mode: 0o700 })
    await cp(join(repoRoot, 'apps/node/dist'), join(nodeRuntime, 'dist'), { recursive: true })
    await symlink(join(repoRoot, 'apps/desktop/node_modules'), join(nodeRuntime, 'node_modules'), 'dir')
    await writeFile(join(nodeRuntime, 'package.json'), '{"type":"module"}\n', { mode: 0o600 })
    const migrations = join(nodeRuntime, 'migrations')
    await cp(join(repoRoot, 'packages/node-core/migrations'), migrations, { recursive: true })
    for (const plugin of await readdir(join(repoRoot, 'plugins'), { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue
      const source = join(repoRoot, 'plugins', plugin.name, 'migrations')
      try { await stat(join(source, 'meta', '_journal.json')) } catch { continue }
      await cp(source, join(migrations, plugin.name), { recursive: true })
    }

    screen = createScreen(options.cols, options.rows)
    log = createWriteStream(join(directory, 'logs', 'tui.ansi'), { flags: 'a', mode: 0o600 })
    trace = createWriteStream(join(directory, 'logs', 'input.jsonl'), { flags: 'a', mode: 0o600 })
    app = pty.spawn(process.execPath, [join(tuiRoot, 'dist', 'main.js')], {
      name: 'xterm-256color', cols: options.cols, rows: options.rows, cwd: tuiRoot,
      env: {
        ...process.env,
        TERM: 'xterm-256color', ACORN_DATA_DIR: dataDir, ACORN_TUI_CONFIG_DIR: configDir,
        ACORN_TUI_NODE_ENTRY: join(nodeRuntime, 'dist', 'standalone.js'),
      },
    })

    let opening = false
    let kittyReplied = false
    let outputTail = ''
    let readyResolve
    let readyReject
    const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady })
    const readyTimeout = setTimeout(() => readyReject(new Error('The TUI drew no first frame within 120 seconds. See logs/tui.ansi.')), 120_000)
    app.onData((output) => {
      log.write(output)
      outputTail = `${outputTail}${output}`.slice(-64)
      if (outputTail.includes('\x1b[?1049h')) opening = true
      if (options.keyboard === 'kitty' && !kittyReplied && outputTail.includes('\x1b[?u')) {
        app.write('\x1b[?7u')
        kittyReplied = true
      }
      void screen.write(output).then(async () => {
        if (opening && (await screen.snapshot()).text.trim()) readyResolve()
      }).catch(readyReject)
    })
    let exitResolve
    const exited = new Promise((resolveExit) => { exitResolve = resolveExit })
    app.onExit(({ exitCode: code, signal }) => {
      exitCode = code
      exitSignal = signal
      readyReject(new Error(`The TUI exited before its first frame (${signal || code}). See logs/tui.ansi.`))
      exitResolve()
    })

    try { await ready } finally { clearTimeout(readyTimeout) }

    const request = async (message) => {
      const command = message?.command
      if (command === 'snapshot') return await screen.snapshot()
      if (command === 'status') return { name, status: 'ready', appPid: app.pid, cols: options.cols, rows: options.rows, dataDir, configDir, keyboard: options.keyboard }
      if (command === 'press') {
        if (typeof message.key !== 'string') throw new Error('press requires a key.')
        const bytes = keyBytes(message.key, options.keyboard)
        app.write(bytes)
        trace.write(`${JSON.stringify({ at: new Date().toISOString(), command, key: message.key })}\n`)
        await settleInput()
        await screen.snapshot()
        return { pressed: message.key }
      }
      if (command === 'type' || command === 'paste') {
        if (typeof message.text !== 'string') throw new Error(`${command} requires text.`)
        if (message.text.length > 64_000) throw new Error('Text is too long.')
        const bytes = command === 'paste' ? `\x1b[200~${message.text}\x1b[201~` : message.text
        app.write(bytes)
        trace.write(`${JSON.stringify({ at: new Date().toISOString(), command, length: message.text.length })}\n`)
        await settleInput()
        await screen.snapshot()
        return { sent: command, length: message.text.length }
      }
      if (command === 'resize') {
        const cols = dimension(message.cols, 'Columns')
        const rows = dimension(message.rows, 'Rows')
        app.resize(cols, rows)
        screen.resize(cols, rows)
        options.cols = cols
        options.rows = rows
        trace.write(`${JSON.stringify({ at: new Date().toISOString(), command, cols, rows })}\n`)
        await settleInput()
        await screen.snapshot()
        return { cols, rows }
      }
      if (command === 'stop') {
        stopRequested = true
        return { stopping: name }
      }
      throw new Error(`Unknown command: ${command}`)
    }

    server = createServer(async (incoming, outgoing) => {
      if (incoming.method !== 'POST' || incoming.url !== '/command') { send(outgoing, 404, { error: 'Not found.' }); return }
      if (incoming.headers.authorization !== `Bearer ${secret}`) { send(outgoing, 401, { error: 'Unauthorized.' }); return }
      try {
        const message = await bodyOf(incoming)
        const result = await request(message)
        send(outgoing, 200, result)
        if (message.command === 'stop') setImmediate(() => app?.kill('SIGTERM'))
      } catch (error) { send(outgoing, 400, { error: error instanceof Error ? error.message : String(error) }) }
    })
    await new Promise((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    if (exitCode !== null) throw new Error(`The TUI exited while the driver was starting (${exitSignal || exitCode}).`)
    const address = server.address()
    const endpoint = `http://127.0.0.1:${address.port}`
    await writePrivateJson(manifestFile, {
      ...base, status: 'ready', appPid: app.pid, endpoint, secret,
      cols: options.cols, rows: options.rows, startedAt: new Date().toISOString(),
    })
    console.log(`[tui-agent:${name}] ready`)
    console.log(`Control it with: pnpm --filter @acorn/tui agent:ui -- --session ${name} snapshot`)
    console.log(`Stop it with: pnpm --filter @acorn/tui agent:ui -- --session ${name} stop`)
    await Promise.race([
      exited,
      new Promise((resolveStop) => {
        process.once('SIGINT', () => { stopRequested = true; resolveStop() })
        process.once('SIGTERM', () => { stopRequested = true; resolveStop() })
      }),
    ])
    status = stopRequested || exitCode === 0 ? 'stopped' : 'failed'
  } finally {
    if (app && exitCode === null) {
      app.kill('SIGTERM')
      await new Promise((resolveWait) => setTimeout(resolveWait, 400))
      if (exitCode === null) app.kill('SIGKILL')
    }
    await new Promise((resolveClose) => server?.close(resolveClose) ?? resolveClose())
    screen?.dispose()
    log?.end()
    trace?.end()
    await writePrivateJson(manifestFile, { ...base, status, exitCode, exitSignal, stoppedAt: new Date().toISOString() })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
