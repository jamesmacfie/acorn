import { createAdaptorServer, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import type { NodeKeys, ServiceEndpoint } from '@acorn/protocol/serviceProtocol.ts'
import { createServer as createHttpsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createApp } from '../index'
import { makeBindings, type RuntimeBindings } from '../bindings'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { type DataRoot } from '../storage/dataRoot'
import { resolveDatabasePath } from '../storage/paths'
import { configuredPort, devDataDir } from './listenerConfig'
import { advertisedHosts } from './advertise'
import { relaySettings } from './relaySettings'
import { ensureCert } from './tls'
import { attachWsHub, disposeWsHub } from './wsHub'
import type { RelayTunnel } from './relayTunnel'
import type { Env } from '../bindings'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('server')
const nodeLog = createLogger('node')

// Dev data root: the repo-local apps/node/.acorn (gitignored). It belongs to apps/node because the node
// owns SQLite, blobs and the node identity (../storage/paths.ts). Only valid while running from a checkout:
// a packaged app's module dir is inside the read-only bundle, so the desktop shell passes an
// application-data root instead.
export { devDataDir }

// Each listener's relay tunnel, if it has relay settings, so closeListener can stop it. A promise,
// because the tunnel's module loads on demand and the listener may close before it arrives.
const relayTunnels = new WeakMap<object, Promise<RelayTunnel>>()

// What the listener bound, plus the certificate identity it bound it with. The endpoint is reported after
// the kernel chooses a port; the fingerprint and certificate let the broker pin that endpoint.
export type Listener = { server: ServerType; endpoint: ServiceEndpoint; fingerprint: string; certPem: string }

// Who already has the port we wanted. "Taken" on its own sends the reader to `lsof` anyway, and the
// answer is almost always another node of our own: a second checkout, an agent session, or a previous
// run that outlived its shell. `node.lock` names the holder of a data root the same way
// (../storage/dataRoot.ts); this is the same courtesy for the other thing two nodes contend over.
//
// Only ever runs on the failure path, so a synchronous spawn costs a healthy boot nothing. Best
// effort: `lsof` is absent on some machines and refuses to name a process owned by another user, and
// neither is worth turning a recoverable port clash into a failed start.
function describePortHolder(port: number): string {
  // stderr is discarded rather than inherited, which is what execFileSync does by default: `lsof`
  // warns about every directory it cannot read, and those warnings would land in the log looking like
  // ours.
  const capture = (file: string, args: string[]): string =>
    execFileSync(file, args, { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    const pid = capture('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
      .split('\n')[0]
      ?.trim()
    if (!pid) return 'something this node could not identify'
    // The command line, not just the number, because the number is meaningless by the time anyone
    // reads the log and the path says whether this is a second checkout or an agent session.
    const command = capture('ps', ['-o', 'command=', '-p', pid]).trim().slice(0, 200)
    return command ? `pid ${pid} (${command})` : `pid ${pid}`
  } catch {
    return 'something this node could not identify'
  }
}

// Start the loopback HTTPS listener over an already-built runtime. The service composition root wires the
// harness and context bridges before the listener accepts requests. Resolves once listening so callers
// can safely reach the origin.
//
// It takes the DataRoot as well as the runtime because the transport identity lives on disk beside the
// database: the certificate is minted into <root>/tls, and the last bound port is remembered in node.json
// so a restart usually lands back on the same one.
//
// `mark` is the composition root's boot timer, threaded in rather than duplicated, because minting a
// certificate on a first launch and binding a port are two very different costs and a caller timing
// this from outside sees only their sum (apps/node/src/composition/boot.ts § bootTimer).
export function startListener(
  runtime: RuntimeBindings,
  root: DataRoot,
  mark: (label: string) => void = () => {},
): Promise<Listener> {
  // Every bridge, pure-Node domain bridges and the stateful harness and context bridges, is installed by
  // the composition root (`bootNode` in apps/node) before this is called. Core does not import plugin
  // bridge wiring (docs/plugins.md).
  const app = createApp()

  // No static assets and no SPA fallback: the node serves API and event traffic only. The renderer ships
  // with the desktop app and loads from app://acorn, so a node that answered with an HTML shell would only
  // be inviting a browser to treat it as an origin. Unmatched paths get Hono's plain 404.

  const { keyPem, certPem, fingerprint } = ensureCert(root.dir)
  mark('cert')

  // Host guard (docs/node-distribution/reaching.md): binding an interface is not the same as answering
  // to any name on it, so a Host we did not expect is refused. Loopback is always allowed; anything
  // else is here because the operator advertised it (server/transport/advertise.ts).
  //
  // One Set, shared by reference with the upgrade handler below and filled in place once the kernel has
  // picked a port. It starts empty and therefore rejects everything, which is the safe direction for the
  // sliver of time before the listening callback runs. Nobody may copy it: a copy taken while it is still
  // empty makes the Host guard reject every upgrade forever, a bare 403 with nothing logged.
  const allowedHosts = new Set<string>()
  const advertised = runtime.ADVERTISED_HOSTS
  const relay = relaySettings(root)
  // 0.0.0.0 rather than the advertised address itself: children of this node still reach it over loopback
  // with full certificate validation (the cert's SAN is IP:127.0.0.1), so both audiences have to keep
  // working. `endpoint` below stays loopback for the same reason.
  const bindHost = advertised.length > 0 ? '0.0.0.0' : '127.0.0.1'
  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) => {
    const host = request.headers.get('host')
    if (!host || !allowedHosts.has(host)) return new Response('Forbidden host', { status: 403 })
    // serve() below creates a node:https server, whose bindings are still HttpBindings (https.Server
    // extends http.Server), narrowed once here. Env is RuntimeBindings & Partial<HttpBindings> (./bindings),
    // so the merged object is the env the routes see, with no `as unknown as Env` double cast at this seam.
    const env: Env = { ...(nodeEnv as HttpBindings), ...runtime }
    return app.fetch(request, env)
  }

  // An explicit ACORN_PORT is a demand (dev:node, tests) and never falls back. Otherwise prefer the port
  // this root last bound, so a restart usually keeps the same endpoint, and fall back to ephemeral when
  // something else has taken it. An advertised Node never falls back: a client on another machine dials
  // the port it remembers, so a moved port would strand every one of them.
  const requested = configuredPort() ?? root.preferredPort ?? 0
  const mayFallBack = configuredPort() === undefined && requested !== 0 && advertised.length === 0

  // createAdaptorServer plus an explicit listen() rather than serve(): a retry after EADDRINUSE has to
  // re-listen the same server object, or the hub below would be attached to a discarded one.
  const server = createAdaptorServer({
    fetch,
    createServer: createHttpsServer,
    // TLS 1.3 only (docs/security/transport-and-auth.md § Transport and auth). Every client is one we ship, the
    // broker's https.Agent, `ws`, and Node children, so there is no legacy peer to accommodate, and
    // pinning the floor here means the transport cannot be downgraded.
    serverOptions: { key: keyPem, cert: certPem, minVersion: 'TLSv1.3' },
    hostname: bindHost,
  })

  // The one authenticated WebSocket (/v1/events) shares this listener via its 'upgrade' event; the hub
  // re-checks Host plus a device bearer or the internal token before the handshake, and holds the device
  // service so a revoked device's sockets close immediately. https.Server extends http.Server, so the
  // hub's node:http typing still describes it exactly.
  //
  // The same `allowedHosts` Set the fetch guard above reads, by reference. See the note there for why it
  // must not be copied.
  attachWsHub(server as unknown as import('node:http').Server, {
    internalToken: runtime.INTERNAL_TOKEN,
    internalCredentials: runtime.INTERNAL_CREDENTIALS,
    allowedHosts,
    devices: runtime.DEVICES,
  })

  // Binding is asynchronous. Resolve only once listening so callers can safely reach the origin without a
  // race. Reject on listen failure so bootstrap can surface it instead of the raw 'error' event crashing
  // the process before any window exists.
  return new Promise((resolveServer, reject) => {
    // Exactly once. Retrying port 0 on an EADDRINUSE would be an unbounded warn-and-relisten loop (ephemeral
    // exhaustion is the only way to get there, and it does not clear by retrying). A spinning process is a
    // worse failure than a rejected start.
    let retried = false
    const onError = (error: NodeJS.ErrnoException): void => {
      if (mayFallBack && !retried && error.code === 'EADDRINUSE') {
        // The remembered port belongs to someone else now. An ephemeral port is still a correct endpoint,
        // since the client is told where we bound rather than assuming, so this is a retry.
        retried = true
        log.warn(`port ${requested} is taken by ${describePortHolder(requested)}; binding an ephemeral port instead`)
        server.listen(0, bindHost, onListening)
        return
      }
      if (error.code === 'EADDRINUSE' && advertised.length > 0)
        return reject(
          new Error(
            `port ${requested} is taken by ${describePortHolder(requested)}. Other machines reach this Node on that port, so it won't start on another. Free the port, or stop advertising this Node.`,
          ),
        )
      reject(error)
    }
    function onListening(): void {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('acorn server bound no TCP port'))
      // Filled in place, never reassigned: the upgrade handler holds this same Set.
      allowedHosts.add(`127.0.0.1:${address.port}`)
      for (const host of advertised) allowedHosts.add(`${host}:${address.port}`)
      // Relayed clients name the Node by its route, which is its ID, and no port (docs/relay.md). The
      // tunnel loads only here, so a Node with no relay settings runs none of its code.
      if (relay) {
        const https = server as unknown as import('node:https').Server
        relayTunnels.set(
          server,
          import('./relayTunnel').then(({ relayHost, startRelayTunnel }) => {
            allowedHosts.add(relayHost(root.nodeId))
            return startRelayTunnel(https, relay, root.nodeId)
          }),
        )
      }
      root.recordPort(address.port)
      log.info(`listening on https://127.0.0.1:${address.port}`)
      for (const host of advertised) log.info(`also answering to https://${host}:${address.port}`)
      server.off('error', onError) // listening, later runtime errors are not listen failures
      // Loopback, even when advertising: this origin is handed to child processes, which validate the
      // certificate fully against its IP:127.0.0.1 SAN. The address a remote client uses is the one the
      // operator was shown, not this.
      mark('bind')
      resolveServer({
        server,
        endpoint: { origin: `https://127.0.0.1:${address.port}`, port: address.port },
        fingerprint,
        certPem,
      })
    }
    server.on('error', onError)
    server.listen(requested, bindHost, onListening)
  })
}

// Stop accepting, then reap every socket this listener still owns. Both composition roots call it as the
// first teardown step, and it lives here rather than in either of them because it is the only place that
// knows what `startListener` attached: an upgrade handler with its own socket set, which `server.close()`
// can't see. Running first means the listener and its upgraded connections stop before plugin and
// database teardown begins.
export function closeListener(server: ServerType | null): Promise<void> {
  if (!server) return Promise.resolve()
  const httpServer = server as unknown as import('node:http').Server
  void relayTunnels.get(server)?.then((tunnel) => tunnel.close())
  disposeWsHub(httpServer)
  return new Promise((resolve) => {
    server.close(() => resolve())
    // Node otherwise waits out keepAliveTimeout for an idle renderer or fetch socket. Once close() has
    // stopped new requests, loopback connections are safe to reap immediately; WebSockets were already
    // terminated by disposeWsHub above.
    httpServer.closeIdleConnections?.()
    httpServer.closeAllConnections?.()
  })
}

// Shutdown drains in-flight work with a bounded timeout. The process exits even if one plugin's dispose
// never settles.
const DRAIN_TIMEOUT_MS = 30_000

// Run a drain to completion or to the deadline, whichever comes first, reporting which. The steps are
// awaited in order (each one's teardown assumes the previous one finished: plugins before core's SQLite
// before the root lock), so the deadline covers the sequence rather than each step. A step that hangs must
// not get its own fresh 30 seconds after two others already spent theirs.
export async function drainWithDeadline(
  steps: readonly (readonly [string, () => Promise<unknown>])[],
  timeoutMs = DRAIN_TIMEOUT_MS,
): Promise<'drained' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
    timer.unref?.()
  })
  const run = (async (): Promise<'drained'> => {
    for (const [label, step] of steps) {
      try {
        await step()
      } catch (error) {
        // A failed step is not a reason to skip the rest: the root lock still has to come off.
        nodeLog.warn(`${label} teardown failed: ${describeError(error).message}`)
      }
    }
    return 'drained'
  })()
  try {
    return await Promise.race([run, expired])
  } finally {
    clearTimeout(timer)
  }
}

// One definition of the on-disk app-data layout under a data root (DB, blobs). Every composition root
// builds its runtime through it, by way of `bootNode`.
//
// It takes an already-opened DataRoot rather than a path because the root carries the nodeId and the
// exclusive lock. The lock's lifetime is the process's, so acquiring it belongs to whoever owns teardown
// (the composition root), not to a bindings factory that has no stop() to hook.
export function makeRuntime(
  root: DataRoot,
  capabilities = new CapabilityRegistry(),
  serviceInstanceId?: string,
  keys?: NodeKeys,
): RuntimeBindings {
  return makeBindings({
    keys,
    dbPath: resolveDatabasePath(root.dir),
    blobsDir: resolve(root.dir, 'blobs'),
    nodeId: root.nodeId,
    serviceInstanceId,
    advertisedHosts: advertisedHosts(root),
    capabilities,
  })
}
