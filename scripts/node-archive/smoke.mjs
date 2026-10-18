// Extracts a platform archive outside the checkout, runs a Node from it, then installs and removes it, as
// a person on a clean machine would (docs/node-distribution.md § Archives). CI runs it on the platform
// the archive is for.
//
//   node scripts/node-archive/smoke.mjs <archive>
//
// It leaves its scratch folder behind when a check fails, and prints the Node's log.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { tar } from '../../apps/desktop/scripts/node-runtime.mjs'

const archive = resolve(process.argv[2] ?? '')
if (!existsSync(archive)) throw new Error('Name the archive to check: node scripts/node-archive/smoke.mjs <archive>')
const windows = process.platform === 'win32'

const scratch = mkdtempSync(join(tmpdir(), 'acorn-archive-smoke-'))
const extract = spawnSync(tar, ['-xf', archive, '-C', scratch], { stdio: 'inherit' })
if (extract.status !== 0) throw new Error(`${tar} could not extract ${archive}.`)
const root = join(scratch, basename(archive).replace(/\.(tar\.gz|zip)$/, ''))
const home = join(scratch, 'home')
const dataDir = join(scratch, 'data')
mkdirSync(home)

// Built from nothing, so the archive can't lean on the runner's own state or on a Node.js on its PATH.
const system = windows ? process.env.SystemRoot : null
const baseEnv = {
  HOME: home,
  USERPROFILE: home,
  APPDATA: join(home, 'AppData/Roaming'),
  LOCALAPPDATA: join(home, 'AppData/Local'),
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local/share'),
  PATH: windows ? `${system}\\System32;${system}` : '/usr/bin:/bin:/usr/sbin:/sbin',
  // Windows programs need these to find the system and a temporary folder.
  ...(windows && { SystemRoot: system, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT, TEMP: tmpdir(), TMP: tmpdir() }),
}
const env = { ...baseEnv, ACORN_DATA_DIR: dataDir }

const launcher = join(root, 'bin', windows ? 'acorn.cmd' : 'acorn')
// A .cmd runs only through a shell, so Windows gets one command line. Every argument is this script's own.
const acorn = (args, environment = env, command = launcher) =>
  spawnSync(windows ? `"${command}" ${args.join(' ')}` : command, windows ? [] : args, {
    env: environment,
    encoding: 'utf8',
    shell: windows,
    timeout: 120_000,
  })

let serviceLog = null
const nodeLogs = () => {
  const logs = join(dataDir, 'logs')
  const files = existsSync(logs) ? readdirSync(logs, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(logs, entry.name)) : []
  return serviceLog && existsSync(serviceLog) ? [serviceLog, ...files] : files
}
const fail = (message, result) => {
  console.error(`[smoke] ${message}`)
  if (result) console.error(`exit ${result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  for (const log of nodeLogs()) console.error(`--- ${log}\n${readFileSync(log, 'utf8')}`)
  console.error(`[smoke] kept ${scratch}`)
  process.exit(1)
}
const json = (args, environment = env, command = launcher) => {
  const result = acorn([...args, '--output', 'json'], environment, command)
  if (result.status !== 0) fail(`acorn ${args.join(' ')} failed.`, result)
  return JSON.parse(result.stdout)
}

const unset = acorn(['--help'], baseEnv)
if (unset.status === 0 || !unset.stderr.includes('ACORN_DATA_DIR')) fail('bin/acorn without ACORN_DATA_DIR did not name it.', unset)

const help = acorn(['--help'])
if (help.status !== 0) fail('bin/acorn --help failed.', help)
console.log('[smoke] bin/acorn --help')

// Loading node-pty catches a missing native build, and spawning catches spawn-helper's mode on macOS.
const ptyCheck = `
const pty = require(${JSON.stringify(join(root, 'lib/node_modules/node-pty'))})
const term = ${windows} ? pty.spawn('cmd.exe', ['/c', 'echo ok'], {}) : pty.spawn('/bin/sh', ['-c', 'echo ok'], {})
let output = ''
term.onData((data) => { output += data })
term.onExit(({ exitCode }) => setTimeout(() => {
  if (exitCode !== 0 || !output.includes('ok')) { console.error('exit ' + exitCode + ': ' + JSON.stringify(output)); process.exit(1) }
}, 200))
`
const pty = spawnSync(join(root, 'runtime', windows ? 'node.exe' : 'node'), ['-e', ptyCheck], { env, encoding: 'utf8', timeout: 30_000 })
if (pty.status !== 0) fail('The runtime could not spawn a terminal through node-pty.', pty)
console.log('[smoke] node-pty spawned a terminal')

json(['node', 'start', '--background'])
const status = json(['node', 'status'])
serviceLog = status.logPath
if (status.state !== 'running' || !status.healthy) fail(`node status reported ${JSON.stringify(status)}.`)
console.log(`[smoke] Node ${status.nodeId} running at ${status.endpoint}`)

const pairing = json(['node', 'pair'])
if (!pairing.code) fail(`node pair returned no code: ${JSON.stringify(pairing)}.`)
console.log('[smoke] node pair opened a code')

const started = Date.now()
const stopped = json(['node', 'stop'])
if (stopped.state !== 'stopped' || Date.now() - started > 40_000) fail(`node stop reported ${JSON.stringify(stopped)} after ${Date.now() - started} ms.`)
console.log(`[smoke] node stop in ${Date.now() - started} ms`)

const leaked = nodeLogs().filter((log) => readFileSync(log, 'utf8').includes('acorn_dt_'))
if (leaked.length) fail(`A device token reached ${leaked.join(', ')}.`)
if (!nodeLogs().length) fail('The Node wrote no log to search for device tokens.')
console.log(`[smoke] no device token in ${nodeLogs().length} log files`)

// The installer refuses root and an elevated administrator, which is what Linux containers and Windows
// runners give it, so there only the archive itself is checked.
const elevated = windows ? spawnSync('net', ['session'], { stdio: 'ignore' }).status === 0 : process.getuid() === 0
if (elevated) console.log('[smoke] skipped the installer, which refuses root and an elevated administrator')
else {
  // A real service only on a macOS runner, never on a developer's machine.
  const service = process.env.GITHUB_ACTIONS === 'true' && process.platform === 'darwin'
  const installRoot = windows
    ? join(baseEnv.LOCALAPPDATA, 'acorn-node')
    : process.platform === 'darwin'
      ? join(home, 'Library/Application Support/acorn-node')
      : join(baseEnv.XDG_DATA_HOME, 'acorn-node')
  const shim = windows ? join(installRoot, 'bin/acorn.cmd') : join(home, '.local/bin/acorn')
  const options = { env: baseEnv, encoding: 'utf8', timeout: 300_000 }
  const installer = (args, windowsArgs) =>
    windows
      ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'install.ps1'), ...windowsArgs], options)
      : spawnSync(join(root, 'install.sh'), args, options)

  const installed = installer([service ? '--service' : '--no-service'], ['-NoService'])
  if (installed.status !== 0) fail('The installer failed.', installed)
  console.log(`[smoke] installed into ${installRoot}`)
  if (!service) json(['node', 'start', '--background'], baseEnv, shim)
  const running = json(['node', 'status'], baseEnv, shim)
  if (running.state !== 'running') fail(`The installed acorn reported ${JSON.stringify(running)}.`)
  if (!existsSync(join(installRoot, 'node/node.json'))) fail(`The installed Node kept no data in ${installRoot}/node.`)
  if (service) {
    const registration = json(['node', 'service', 'status'], baseEnv, shim)
    if (!registration.loaded || !registration.running) fail(`node service status reported ${JSON.stringify(registration)}.`)
    console.log(`[smoke] ${registration.manager} runs the installed Node`)
  }
  console.log('[smoke] the installed acorn runs a Node in the default data folder')

  const removed = installer(['--uninstall'], ['-Uninstall'])
  if (removed.status !== 0) fail('The installer could not uninstall.', removed)
  if (existsSync(shim) || existsSync(join(installRoot, 'versions'))) fail('The uninstall left the command or a version behind.')
  if (!existsSync(join(installRoot, 'node/node.json'))) fail('The uninstall removed the data folder.')
  console.log('[smoke] uninstalled, keeping the data folder')
}

rmSync(scratch, { recursive: true, force: true })
