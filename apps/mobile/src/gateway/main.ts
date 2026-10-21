import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { renderUnicodeCompact } from 'uqr'
import { NodeBroker, toNodeRecord, type FleetNode } from '@acorn/custody/broker'
import {
  configDir,
  custody,
  dataRootDir,
  pairInteractively,
  rememberedNode,
  runningNode,
  usableLocalToken,
  type Custody,
} from '@acorn/custody/local'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { startGateway, type Gateway } from './gateway'
import { sessionStore } from './sessions'

// The gateway's command: serve one Node to phones, or list and revoke their sessions. Its device token,
// its fleet file, and the phones' sessions live in their own directory, so the Node lists the gateway
// as a device of its own.

const DEFAULT_PORT = 4320
const USAGE = `Usage: gateway [--node NAME|URL] [--port N] [--origin URL] [--app-dir PATH]
       gateway sessions
       gateway revoke ID`

const dir = join(configDir(), 'mobile')
const sessions = sessionStore(join(dir, 'sessions'))

// The Node this gateway serves: a remembered one named with --node, or the one running on this
// computer. A Node it holds no token for is paired by approval or a typed code, as the CLI pairs.
async function pairedNode({ tokens, fleet }: Custody, target: string | undefined): Promise<FleetNode> {
  const deviceName = `Acorn mobile on ${hostname()}`
  if (target) {
    const known = rememberedNode(fleet, target)
    if (known) return known
    if (!target.startsWith('https://'))
      throw new Error(`The gateway knows no Node called "${target}". Name a paired one, or an https:// address.`)
    return pairInteractively(target, fleet, { label: new URL(target).host, local: false, deviceName })
  }
  const running = runningNode(dataRootDir())
  if (!running) throw new Error(`No Node is running for ${dataRootDir()}. Start one with pnpm dev or pnpm dev:node.`)
  const label = fleet.get(running.nodeId)?.label ?? 'This computer'
  const token = await usableLocalToken(running, tokens)
  if (!token) return pairInteractively(running.endpoint, fleet, { label, local: true, deviceName })
  // `pid` isn't part of a fleet row, and the fleet file's strict schema would refuse the whole file.
  const { pid: _pid, ...record } = running
  return fleet.remember({ ...record, label, local: true }, token)
}

function printSignIn(origin: string, code: string): void {
  console.log(`\n${renderUnicodeCompact(origin)}\n`)
  console.log(`  Open on your phone   ${origin}`)
  console.log(`  Sign-in code         ${code}   (one phone, 10 minutes)`)
  console.log(`  Another code         kill -USR1 ${process.pid}\n`)
}

async function serve(flags: { node?: string; port?: string; origin?: string; 'app-dir'?: string }): Promise<void> {
  const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`--port takes a port number.\n${USAGE}`)
  // The listening address itself, because `localhost` can resolve to IPv6 and reach something else.
  const origin = new URL(flags.origin ?? `http://127.0.0.1:${port}`).origin
  if (!/^https?:/.test(origin)) throw new Error(`--origin takes an http or https address.\n${USAGE}`)

  // The built web app. A packaged build names its own copy with --app-dir.
  const appDir = flags['app-dir'] ?? fileURLToPath(new URL('../../dist', import.meta.url))
  if (!existsSync(join(appDir, 'index.html')))
    throw new Error(`The web app isn't built at ${appDir}. Run pnpm --filter @acorn/mobile build, or pass --app-dir.`)

  const at = custody(dir)
  const node = await pairedNode(at, flags.node)
  const token = at.fleet.tokenFor(node.nodeId)
  if (!token) throw new Error(`The gateway holds no token for ${node.label}. Pair it again.`)

  let gateway: Gateway | undefined
  const broker = new NodeBroker(
    {
      frame: (_nodeId, frame, viewerId) => gateway?.frame(frame, viewerId),
      bytes: (_nodeId, frame, viewerId) => gateway?.bytes(frame, viewerId),
      status: (status) => gateway?.status(status),
      transportError: (_nodeId, error, viewerId) => gateway?.transportError(error, viewerId),
    },
    { viewerMultiplexing: true },
  )
  const codes = pairingCodes()
  gateway = await startGateway({
    broker,
    nodeId: node.nodeId,
    label: node.label,
    sessions,
    codes,
    origin,
    appDir,
    port,
  })
  broker.upsert({ ...toNodeRecord(node), token, ...(node.certPem ? { certPem: node.certPem } : {}) })

  console.log(`\n  Serving ${node.label} (${node.endpoint}) on 127.0.0.1:${gateway.port}`)
  printSignIn(origin, codes.issue())
  process.on('SIGUSR1', () => printSignIn(origin, codes.issue()))
  const stop = (): void => {
    broker.dispose()
    void gateway?.close().then(() => process.exit(0))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

function listSessions(): void {
  const listed = sessions.list()
  if (!listed.length) return console.log('No phone is signed in.')
  const when = (ms: number): string => new Date(ms).toLocaleString()
  for (const session of listed)
    console.log(
      `${session.id}  ${session.label}\n              signed in ${when(session.createdAt)}, last used ${when(session.lastUsedAt)}`,
    )
}

function revoke(id: string | undefined): void {
  if (!id) throw new Error(USAGE)
  if (!sessions.revoke(id)) throw new Error(`No session has the ID ${id}. Run gateway sessions to list them.`)
  console.log(`Ended session ${id}. A running gateway closes its socket within a second.`)
}

try {
  const { values, positionals } = parseArgs({
    // `pnpm dev:mobile:gateway -- --node x` passes the separator through.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      node: { type: 'string' },
      port: { type: 'string' },
      origin: { type: 'string' },
      'app-dir': { type: 'string' },
    },
    allowPositionals: true,
  })
  const [command, ...rest] = positionals
  if (command === 'sessions') listSessions()
  else if (command === 'revoke') revoke(rest[0])
  else if (command === undefined) await serve(values)
  else throw new Error(USAGE)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
