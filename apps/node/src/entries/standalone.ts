// The entry for `pnpm dev:node` and the packaged standalone Node (docs/node-distribution.md). See
// docs/architecture-overview.md § Runtime topology for how this differs from the supervised node the
// desktop shell starts.
import { closeSync, existsSync, readFileSync, writeSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { devDataDir } from '@acorn/node-core/server/transport/listener.ts'
import { advertisedHosts, confirmAdvertiseHost } from '@acorn/node-core/server/transport'
import { openDataRoot } from '@acorn/node-core/server/storage'
import { enrollNode } from '@acorn/node-core/server/enrollment.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { NODE_PROTOCOL_VERSION, NODE_RESTART_EXIT_CODE } from '@acorn/protocol/node.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth'
import { bootNode } from '../composition/boot'
import { installBackgroundLog } from './background'

// This file is the one place under `apps/node/src` that still calls `console.log`, and it is in the
// console rule's baseline on purpose (tools/arch/boundaries.test.ts). Two things it writes are not
// log lines: the handshake JSON, which a script reads off stdout when no launcher holds pipes, and
// the pairing banner, which is what a person standing at this terminal is here to read.
// Everything else in the file goes through the logger like the rest of the node.
import { installCrashHandlers } from '../composition/crash'
import { createLogger } from '@acorn/node-core/server/telemetry'

// Set when the CLI runs this Node, in the background or the foreground. The CLI holds its token and
// opens codes with `acorn node pair`, so this Node prints no banner and ignores SIGUSR1. Deleted, like
// ACORN_LAUNCHER_PIPES below, so a Node started from one of this Node's terminals is not mistaken for it.
const serviceInstanceId = process.env.ACORN_CLI_SERVICE_ID
const logPath = process.env.ACORN_CLI_LOG_PATH
delete process.env.ACORN_CLI_SERVICE_ID
delete process.env.ACORN_CLI_LOG_PATH
// Before anything can throw. A crash during boot is otherwise a silent death with no record
// (../composition/crash.ts).
if (logPath) installBackgroundLog(logPath)
installCrashHandlers()

// fd 3 and fd 4 are this process's pipes to its launcher, so a Node started from one of this Node's
// terminals must not inherit the setting.
const launcherPipes = process.env.ACORN_LAUNCHER_PIPES === '1'
delete process.env.ACORN_LAUNCHER_PIPES

const log = createLogger('node')
const pluginLog = createLogger('plugins')

// ACORN_DATA_DIR names the data root (docs/data-layer/data-root.md § Where it lives); bootNode hands
// this node's own child processes the same variable, so one spelling of "which root" covers the whole
// process tree. Opening it takes the root's exclusive lock, which is why a standalone node and a
// running desktop app cannot share one.
const root = openDataRoot(process.env.ACORN_DATA_DIR || devDataDir())
// Asked once, before anything else prints (docs/node-distribution/reaching.md); silent under a service
// manager (server/transport/advertise.ts).
await confirmAdvertiseHost(root)
// A standalone Node has no keychain, so its keys are files in the data root or SESSION_ENC_KEY in its
// environment. Agents it runs share its OS user and can read both (docs/security.md § What task scope
// does and doesn't protect against).
log.warn(
  `this Node keeps its signing and encryption keys in ${root.dir} or its environment, where agents it runs can read them`,
)

// The unpacked tarball keeps its bundled plugins beside `dist/` (scripts/pack-node.mjs), and this
// entry is its own chunk, so the folder is one level up from this file. A checkout has no such folder,
// so `pnpm dev:node` and a built `apps/node/dist` still find nothing. ACORN_BUNDLED_PLUGINS_DIR wins.
const packagedPlugins = fileURLToPath(new URL('../plugins', import.meta.url))
const bundledRoot = process.env.ACORN_BUNDLED_PLUGINS_DIR || (existsSync(packagedPlugins) ? packagedPlugins : undefined)
const development = process.env.NODE_ENV !== 'production'
// Looks like a bug and is not one: `dev:node` with no bundled root reconciles nothing, so a
// `build:plugin` copy in the data root keeps running and a newer bundled package never arrives.
// Only a developer needs `ACORN_BUNDLED_PLUGINS_DIR` set.
if (development && !bundledRoot) {
  pluginLog.info(
    'ACORN_BUNDLED_PLUGINS_DIR is unset, so bundled packages are not reconciled. Whatever is in the data root keeps running.',
  )
}

// SIGINT, SIGTERM, and POST /v1/core/node/stop run the same bounded drain as a desktop-supervised
// node (docs/node-distribution.md § Operations). The first request decides the exit code, and a repeat
// is ignored: `acorn node start --foreground` forwards a signal that a terminal or systemd may also
// have sent here, and a second one must not cut the drain short.
//
// Above the boot, because the stop route can call it as soon as the listener binds, before `node`
// exists. That is well after bootNode has returned `booting`.
let stopping = false
async function shutdown(reason: string, restart = false): Promise<void> {
  if (stopping) return
  stopping = true
  log.info(`${reason} — draining`)
  await (await booting).stop()
  process.exit(restart ? NODE_RESTART_EXIT_CODE : 0)
}

// The shared boot (../composition/boot.ts). This host has no start config: no app version, no
// delivered keys, no disabled-plugin override, and no staged MCP entry. It was started from a shell or
// a service manager, so it skips the login shell PATH probe.
const booting = bootNode({
  root,
  serviceInstanceId,
  bundledPluginsDir: bundledRoot,
  development,
  loginShellPath: false,
  requestStop: (restart) => void shutdown(restart ? 'restart requested' : 'stop requested', restart),
})
const node = await booting
const { runtime, listener } = node
// Awaited, unlike the supervised host: a launcher acts on the handshake below, so the node finishes
// re-attaching sessions and repairing worktrees before it prints it.
await node.reconciled

// Unattended enrollment, if and only if the provisioner set both environment variables
// (docs/node-enrollment.md). With neither set this returns before it reads a file, so a node nobody
// provisioned behaves exactly as if this call were not here.
//
// Here rather than earlier because it needs the endpoint and the fingerprint, which only exist once
// the listener has bound. Before the device count below on purpose: a node that just handed its
// control plane a credential is a paired node, and printing a pairing code for a machine nobody is
// standing at would be an unrequested window left open.
//
// The endpoint it enrolls with is the advertised one, not `listener.endpoint.origin`. That value is
// deliberately loopback whatever `advertiseHost` says, because every child process this node spawns
// dials it, and a control plane handed `https://127.0.0.1:<port>` would vouch for an address no other
// machine can reach. With no advertised host the loopback origin is still what goes, which is right for
// a control plane running on this same machine and useless for one that is not — the operator's
// exposure decision either way (docs/node-distribution/reaching.md).
await enrollNode({
  dataDir: root.dir,
  nodeId: root.nodeId,
  endpoint: enrollmentEndpoint(),
  fingerprint: listener.fingerprint,
  devices: runtime.DEVICES,
  db: runtime.DB,
})

// Counted before the handshake below, which issues a piped launcher a device of its own when it
// brings no working token. After that, every node looks paired.
const alreadyPaired = (await runtime.DEVICES.list()).filter((device) => device.revokedAt === null).length

// Signals are wired before anything announces readiness, and the order matters: until the SIGTERM
// listener below is added, SIGTERM keeps its default disposition, so the kernel kills the
// process outright, with no drain and no lock release. A supervisor, or the shutdown integration
// test, acts the instant it sees the handshake line, so anything printed before this point risks
// being killed mid-boot.
//
// SIGUSR1 reopens the pairing window (docs/node-distribution.md § Runtime): no token, no second
// port, and it needs shell access on this machine, the same "the owner is present" property pairing
// itself relies on.
if (!serviceInstanceId) process.on('SIGUSR1', () => printPairingBanner(runtime.PAIRING_CODES.issue()))
process.on('SIGINT', (signal) => void shutdown(signal))
process.on('SIGTERM', (signal) => void shutdown(signal))

const handshake = {
  baseline: ACORN_BASELINE,
  nodeId: root.nodeId,
  // The handshake's protocol number (docs/api-reference/versioning.md § Versioning): a launcher can refuse a
  // node it cannot drive without pairing to it first.
  protocolVersion: NODE_PROTOCOL_VERSION,
  endpoint: listener.endpoint.origin,
  fingerprint: listener.fingerprint,
  certPem: listener.certPem,
}
// The device token has full owner authority, so only a launcher's private pipe carries it
// (docs/node-distribution.md § Runtime). A service manager keeps stdout in a log, and a Node nobody
// launched with pipes issues no launcher device at all.
if (launcherPipes) {
  const deviceToken = await resolveDeviceToken(
    runtime.DEVICES,
    readPrivateToken() || undefined,
    'Standalone node launcher',
  )
  writeSync(3, `${JSON.stringify({ ...handshake, deviceToken })}\n`)
  closeSync(3)
} else console.log(JSON.stringify(handshake))

function readPrivateToken(): string {
  try {
    return readFileSync(4, 'utf8').trim()
  } finally {
    closeSync(4)
  }
}

// The first advertised host, or the loopback origin when there is none. One line, beside the banner
// that makes the same choice for the same reason.
function enrollmentEndpoint(): string {
  const host = advertisedHosts(root)[0]
  return host ? `https://${host}:${listener.endpoint.port}` : listener.endpoint.origin
}

// Prints the pairing banner the owner compares against the client's screen
// (docs/node-distribution.md § Runtime). Opens automatically only while nothing is paired yet, so a
// restart of a working node does not leave an unrequested window live.
function printPairingBanner(code: string | null): void {
  const port = listener.endpoint.port
  const reachable = advertisedHosts(root).map((host) => `https://${host}:${port}`)
  console.log('')
  console.log('  acorn node ready')
  console.log('')
  if (reachable.length > 0) console.log(`    Connect to    ${reachable.join('\n                  ')}`)
  else console.log(`    Connect to    https://127.0.0.1:${port}  (this machine only)`)
  console.log(`    Identity      ${fingerprintPhrase(listener.fingerprint) ?? listener.fingerprint}`)
  if (code) console.log(`    Pairing code  ${code}   (valid 10 minutes)`)
  console.log('')
  if (code) {
    console.log('  In acorn: Settings → Nodes → add a node. Paste the address, check the identity')
    console.log('  words match what acorn shows you, then paste the code.')
  } else {
    console.log(`  ${alreadyPaired} device(s) already paired. For another, run:  acorn node pair`)
    if (process.platform !== 'win32')
      console.log(`  or, from a terminal acorn hasn't paired:  kill -USR1 ${process.pid}`)
  }
  if (reachable.length === 0) {
    console.log('  To reach this node from another machine, run:  acorn node reach <address or name>')
  }
  console.log('')
}

if (!serviceInstanceId) printPairingBanner(alreadyPaired === 0 ? runtime.PAIRING_CODES.issue() : null)
