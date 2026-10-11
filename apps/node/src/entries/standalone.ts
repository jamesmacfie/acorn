// The entry for `pnpm dev:node` and the packaged standalone Node (docs/node-distribution.md). See
// docs/architecture-overview.md § Runtime topology for how this differs from the supervised node the
// desktop shell starts.
import { closeSync, readFileSync, writeSync } from 'node:fs'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { devDataDir } from '@acorn/node-core/server/transport/listener.ts'
import { advertisedHosts, confirmAdvertiseHost } from '@acorn/node-core/server/transport'
import { openDataRoot } from '@acorn/node-core/server/storage'
import { enrollNode } from '@acorn/node-core/server/enrollment.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth'
import { bootNode } from '../composition/boot'
import { installBackgroundLog } from './background'

// This file is the one place under `apps/node/src` that still calls `console.log`, and it is in the
// console rule's baseline on purpose (tools/arch/boundaries.test.ts). Two things it writes are not
// log lines: the handshake JSON, which a launcher parses off stdout and the lifecycle tests read,
// and the pairing banner, which is what a person standing at this terminal is here to read.
// Everything else in the file goes through the logger like the rest of the node.
import { installCrashHandlers } from '../composition/crash'
import { createLogger } from '@acorn/node-core/server/telemetry'

// Before anything can throw. A crash during boot is otherwise a silent death with no record
// (../composition/crash.ts).
const background = process.env.ACORN_CLI_BACKGROUND === '1'
if (background) {
  if (!process.env.ACORN_CLI_LOG_PATH || !process.env.ACORN_CLI_SERVICE_ID) throw new Error('Missing background service configuration')
  installBackgroundLog(process.env.ACORN_CLI_LOG_PATH)
}
installCrashHandlers()

const log = createLogger('node')
const pluginLog = createLogger('plugins')

// ACORN_DATA_DIR names the data root (docs/data-layer/data-root.md § Where it lives); bootNode hands
// this node's own child processes the same variable, so one spelling of "which root" covers the whole
// process tree. Opening it takes the root's exclusive lock, which is why a standalone node and a
// running desktop app cannot share one.
const root = openDataRoot(process.env.ACORN_DATA_DIR || devDataDir())
// Asked once, before anything else prints (docs/node-distribution.md § Reaching a node from another
// machine); silent under a service manager (server/transport/advertise.ts).
await confirmAdvertiseHost(root)
// A standalone Node has no keychain, so its keys are files in the data root or SESSION_ENC_KEY in its
// environment. Agents it runs share its OS user and can read both (docs/security.md § What task scope
// does and doesn't protect against).
log.warn(`this Node keeps its signing and encryption keys in ${root.dir} or its environment, where agents it runs can read them`)

const bundledRoot = process.env.ACORN_BUNDLED_PLUGINS_DIR
const development = process.env.NODE_ENV !== 'production'
// Looks like a bug and is not one: `dev:node` with no bundled root reconciles nothing, so a
// `build:plugin` copy in the data root keeps running and a newer bundled package never arrives. That
// is the right answer for a service-managed node. Only a developer needs
// `ACORN_BUNDLED_PLUGINS_DIR` set.
if (development && !bundledRoot) {
  pluginLog.info('ACORN_BUNDLED_PLUGINS_DIR is unset, so bundled packages are not reconciled. Whatever is in the data root keeps running.')
}

// The shared boot (../composition/boot.ts). This host has no start config: no app version, no
// delivered keys, no disabled-plugin override, and no staged MCP entry. It was started from a shell or
// a service manager, so it skips the login shell PATH probe.
const node = await bootNode({
  root,
  serviceInstanceId: background ? process.env.ACORN_CLI_SERVICE_ID : undefined,
  bundledPluginsDir: bundledRoot,
  development,
  loginShellPath: false,
})
const { runtime, listener } = node
// Awaited, unlike the supervised host: a launcher acts on the handshake below, so the node finishes
// re-attaching sessions and repairing worktrees before it prints it.
await node.reconciled

// Unattended enrollment, if and only if the provisioner set both environment variables
// (docs/node-enrollment.md). With neither set this returns before it reads a file, so a node nobody
// provisioned behaves exactly as it did before this line existed.
//
// Here rather than earlier because it needs the endpoint and the fingerprint, which only exist once
// the listener has bound. Before the device count below on purpose: a node that just handed its
// control plane a credential is a paired node, and printing a pairing code for a machine nobody is
// standing at would be an unrequested window left open.
//
// The endpoint it enrolls with is the advertised one, not `listener.endpoint.origin`. That value is
// deliberately loopback whatever `advertiseHost` says, because every child process this node spawns
// dials it (server/transport/listener.ts), and a control plane handed `https://127.0.0.1:<port>` would vouch for an
// address no other machine can reach. With no advertised host the loopback origin is still what goes,
// which is right for a control plane running on this same machine and useless for one that is not —
// the operator's exposure decision either way (docs/node-distribution.md § Reaching a node from
// another machine).
await enrollNode({
  dataDir: root.dir,
  nodeId: root.nodeId,
  endpoint: enrollmentEndpoint(),
  fingerprint: listener.fingerprint,
  devices: runtime.DEVICES,
  db: runtime.DB,
})

// Counted before the handshake below, which issues a launcher device of its own when
// ACORN_DEVICE_TOKEN is unset. After that, every node looks paired.
const alreadyPaired = (await runtime.DEVICES.list()).filter((device) => device.revokedAt === null).length

// SIGINT and SIGTERM run the same bounded drain as a desktop-supervised node
// (docs/node-distribution.md § Operations).
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  log.info(`${signal} — draining`)
  await node.stop()
  process.exit(0)
}

// Signals are wired before anything announces readiness, and the order matters: until
// `process.once('SIGTERM')` runs, SIGTERM keeps its default disposition, so the kernel kills the
// process outright, with no drain and no lock release. A supervisor, or the shutdown integration
// test, acts the instant it sees the handshake line, so anything printed before this point risks
// being killed mid-boot.
//
// SIGUSR1 reopens the pairing window (docs/node-distribution.md § Runtime): no token, no second
// port, and it needs shell access on this machine, the same "the owner is present" property pairing
// itself relies on.
if (!background) process.on('SIGUSR1', () => printPairingBanner(runtime.PAIRING_CODES.issue()))
process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

const previousToken = background ? readPrivateToken() : process.env.ACORN_DEVICE_TOKEN
const handshake = JSON.stringify({
    baseline: ACORN_BASELINE,
    nodeId: root.nodeId,
    // The handshake's protocol number (docs/api-reference/transport.md § Versioning): a launcher can refuse a
    // node it cannot drive without pairing to it first.
    protocolVersion: NODE_PROTOCOL_VERSION,
    endpoint: listener.endpoint.origin,
    fingerprint: listener.fingerprint,
    certPem: listener.certPem,
    deviceToken: await resolveDeviceToken(runtime.DEVICES, previousToken || undefined, 'Standalone node launcher'),
  })
if (background) {
  writeSync(3, `${handshake}\n`)
  closeSync(3)
}
else console.log(handshake)

function readPrivateToken(): string {
  try { return readFileSync(4, 'utf8').trim() }
  finally { closeSync(4) }
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
    console.log(`  ${alreadyPaired} device(s) already paired. For another, run:  kill -USR1 ${process.pid}`)
  }
  if (reachable.length === 0) {
    console.log('  To reach this node from another machine, set advertiseHost in this data root\'s')
    console.log('  node.json (or ACORN_ADVERTISE_HOST) and restart.')
  }
  console.log('')
}

if (!background) printPairingBanner(alreadyPaired === 0 ? runtime.PAIRING_CODES.issue() : null)
