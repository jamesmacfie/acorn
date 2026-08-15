import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { WebSocket } from 'ws'
import { nodeRequest } from './nodeRequest'
import { WS_PATH, type WsClientFrame } from '@acorn/protocol/ws.ts'
import { NODE_PROTOCOL_VERSION, nodeInfoSchema } from '@acorn/protocol/node.ts'
import {
  type NodeConnectionState,
  type NodeFetchRequest,
  type NodeFetchResponse,
  type NodeRecord,
  type NodeStatus,
} from '@acorn/protocol/broker.ts'

// The connection broker (docs/architecture-overview.md § How the client talks to nodes). Owns, per node:
// the endpoint, the pinned certificate, the device token, one WebSocket, and the connection state.
//
// Electron-free on purpose — it imports node:https and `ws`, nothing from electron — so it can be
// unit-tested against a real TLS server. The IPC wiring that exposes it lives in nodeBrokerIpc.ts.
//
// It must NOT live in @acorn/client-core: the boundary test classifies that package as client-side,
// so a node:https import there would both fail the client/node split rule and drag Node builtins into
// the renderer bundle.

// Reconnect backoff per docs/architecture-overview.md § Failure behavior, capped so a node that is off
// for the night is retried every 30s rather than every 16.
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
const JITTER = 0.2
// A WS that has been down this long while HTTP still works is `degraded`, not `offline`.
const DEGRADED_AFTER_MS = 5_000
const DEFAULT_TIMEOUT_MS = 30_000
const PING_INTERVAL_MS = 15_000
// Two intervals of silence, not one: a single missed pong on a congested link is not evidence, and the
// cost of being wrong is tearing down a working socket and refetching everything on it.
const MISSED_PONGS_BEFORE_DEAD = 2
// Short: this sits in front of the socket on every connect, so a slow or dead node must not delay the
// reconnect it would otherwise get. Timing out here reads as "no clear answer" and the socket opens.
const PROTOCOL_PROBE_TIMEOUT_MS = 5_000

// A node plus the material only main may hold: the bearer, and the certificate to pin against.
export type BrokerNode = NodeRecord & { token: string; certPem?: string }

export type BrokerEvents = {
  // A server→client frame arrived. Forwarded verbatim; the broker does not interpret channels.
  frame(nodeId: string, frame: unknown): void
  status(status: NodeStatus): void
}

type Connection = {
  node: BrokerNode
  agent: HttpAgent | HttpsAgent
  ws: WebSocket | null
  // Frames the renderer sent before the socket was open. Kept here as well as in the renderer's own
  // outbox because a reconnect happens entirely inside main and the renderer never learns of it.
  outbox: string[]
  state: NodeConnectionState
  error: NodeStatus['error']
  attempt: number
  reconnectTimer: NodeJS.Timeout | null
  // The heartbeat's own timer and its miss counter. Per connection, not per broker: nodes are on
  // different links and a slept laptop must not condemn the loopback node beside it.
  pingTimer: NodeJS.Timeout | null
  missedPongs: number
  wsDownSince: number | null
  lastHttpOkAt: number | null
  lastSeenAt: number | null
  // Per-connection monotonic counter from the server. A gap means frames were lost, which the protocol
  // says to treat as a reconnect (docs/api-reference.md § Events).
  seq: number
  closed: boolean
}

export class NodeBroker {
  private readonly connections = new Map<string, Connection>()
  private readonly inFlight = new Map<string, AbortController>()
  private readonly pingIntervalMs: number

  // The heartbeat cadence is injectable for the same reason node-core's `revocationCheckMs` is: the
  // interval runs for REAL in tests, so the assertion is that the socket actually died rather than that
  // a timer was scheduled. Faking the clock would test the schedule and not the behaviour.
  constructor(
    private readonly events: BrokerEvents,
    options: { pingIntervalMs?: number } = {},
  ) {
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS
  }

  // Add or replace a node. Replacing tears the old connection down first, so a re-pair with a new
  // token or a moved endpoint cannot leave a socket authenticated by the previous credential.
  upsert(node: BrokerNode): void {
    this.remove(node.nodeId)
    const agent = node.endpoint.startsWith('https:')
      ? new HttpsAgent({ keepAlive: true, ...this.pinning(node) })
      : new HttpAgent({ keepAlive: true })
    const connection: Connection = {
      node,
      agent,
      ws: null,
      outbox: [],
      state: 'offline',
      error: undefined,
      attempt: 0,
      reconnectTimer: null,
      pingTimer: null,
      missedPongs: 0,
      wsDownSince: Date.now(),
      lastHttpOkAt: null,
      lastSeenAt: null,
      seq: 0,
      closed: false,
    }
    this.connections.set(node.nodeId, connection)
    void this.openConnection(connection)
  }

  // The version gate, and the reason it is here rather than at pairing: pairing checks once, and a node
  // upgrades. `incompatible` and `protocol_mismatch` have been in the protocol since it was written with
  // nothing anywhere producing either, so a node that drifted past this client kept connecting and failed
  // later as an `undefined` deep inside a component.
  //
  // Before the socket, not alongside it: a client that cannot speak the protocol should not open a
  // WebSocket and start interpreting frames on it.
  //
  // A failure to REACH the node is not a version failure — it is the ordinary offline path, and treating
  // an unreachable node as incompatible would be a sticky, alarming state for a laptop that is merely
  // asleep. So only a definite, parseable, different major stops us; anything else opens the socket and
  // lets the existing reconnect machinery say what it always said.
  private async openConnection(connection: Connection): Promise<void> {
    if (connection.closed) return
    const major = await this.probeProtocol(connection)
    if (connection.closed) return
    if (major !== null && major !== NODE_PROTOCOL_VERSION) {
      // Sticky, like `revoked`: retrying cannot fix a version, and `downState` already refuses to
      // downgrade either state. Only an upsert — a re-pair, or the app relaunching after an upgrade —
      // clears it, which is exactly when the answer could have changed.
      this.setState(connection, 'incompatible', { code: 'protocol_mismatch' })
      connection.closed = true
      return
    }
    this.openSocket(connection)
  }

  // The node's own claim, over the pinned agent. Unauthenticated `GET /v2/node` — it needs no token, and
  // asking for one here would confuse "your device was revoked" with "we disagree about the protocol".
  //
  // `null` for anything that is not a clear answer: unreachable, non-JSON, or a body without a numeric
  // protocol. The schema is additive-forever so a newer node still parses; if it somehow does not, the
  // raw field is still read, because refusing to learn a version from a response we could not fully
  // parse is how a client ends up unable to explain itself.
  private async probeProtocol(connection: Connection): Promise<number | null> {
    try {
      const response = await nodeRequest({
        url: new URL('/v2/node', connection.node.endpoint),
        method: 'GET',
        // Deliberately no authorization header: this is the pre-auth identity route, and sending the
        // bearer would let a revoked device read "unauthorized" as a version disagreement.
        headers: {},
        agent: connection.agent,
        signal: AbortSignal.timeout(PROTOCOL_PROBE_TIMEOUT_MS),
      })
      if (response.status !== 200) return null
      const payload: unknown = JSON.parse(new TextDecoder().decode(response.body))
      const parsed = nodeInfoSchema.safeParse(payload)
      if (parsed.success) return parsed.data.protocolVersion
      const claimed = (payload as { protocolVersion?: unknown } | null)?.protocolVersion
      return typeof claimed === 'number' ? claimed : null
    } catch {
      return null
    }
  }

  remove(nodeId: string): void {
    const connection = this.connections.get(nodeId)
    if (!connection) return
    connection.closed = true
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer)
    this.stopHeartbeat(connection)
    connection.ws?.terminate()
    connection.agent.destroy()
    this.connections.delete(nodeId)
  }

  list(): NodeRecord[] {
    // Never leak the token out of main, even to the renderer's own projection.
    return [...this.connections.values()].map(({ node: { token: _token, ...record } }) => record)
  }

  statuses(): NodeStatus[] {
    return [...this.connections.values()].map((c) => this.statusOf(c))
  }

  dispose(): void {
    for (const nodeId of [...this.connections.keys()]) this.remove(nodeId)
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }

  // --- HTTP ---

  async fetch(nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse> {
    const connection = this.connections.get(nodeId)
    if (!connection) throw new Error(`Unknown node ${nodeId}`)

    const controller = new AbortController()
    this.inFlight.set(request.requestId, controller)
    // Which side aborted is the whole difference between "the node is gone" and "we changed our mind".
    // The timer's abort is evidence about the node; `abort(requestId)` from the renderer is not.
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const response = await nodeRequest({
        // `new URL(path, endpoint)` with a path validated to start with '/' cannot escape the
        // endpoint's origin, so a renderer cannot aim a request at another host.
        url: new URL(request.path, connection.node.endpoint),
        method: request.method ?? 'GET',
        headers: {
          ...request.headers,
          // Attached HERE, never by the renderer. That is the point of the broker.
          authorization: `Bearer ${connection.node.token}`,
        },
        body: request.body,
        agent: connection.agent,
        signal: controller.signal,
      })
      this.noteHttpResult(connection, response)
      return response
    } catch (error) {
      // A cancellation the RENDERER asked for says nothing about the node's health. Marking it `offline`
      // here was a live bug: a query aborted on unmount (or superseded by a refetch) flipped a perfectly
      // healthy node to `offline`, and apiClient then fail-fasts every mutation with "This node is
      // offline" until the next successful read happens to clear it.
      if (isAbort(error) && !timedOut) throw error
      this.noteHttpFailure(connection, error)
      // Renamed so the two aborts stay distinguishable one layer up (nodeBrokerIpc.ts swallows the
      // renderer's cancellation and must not swallow this), and because "the operation was aborted" is a
      // useless thing to show someone whose node stopped answering.
      if (isAbort(error)) {
        throw Object.assign(new Error(`The node did not answer within ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`), { name: 'TimeoutError' })
      }
      throw error
    } finally {
      clearTimeout(timeout)
      this.inFlight.delete(request.requestId)
    }
  }

  abort(requestId: string): void {
    this.inFlight.get(requestId)?.abort()
  }

  // --- WebSocket ---

  send(nodeId: string, frame: WsClientFrame): void {
    const connection = this.connections.get(nodeId)
    if (!connection) return
    const payload = JSON.stringify(frame)
    if (connection.ws?.readyState === WebSocket.OPEN) connection.ws.send(payload)
    else connection.outbox.push(payload)
  }

  private openSocket(connection: Connection): void {
    if (connection.closed) return
    const url = new URL(WS_PATH, connection.node.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // The bearer rides the upgrade request's headers, which a browser cannot set — one of the reasons
    // the socket belongs to main rather than the renderer.
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${connection.node.token}` },
      agent: connection.agent,
    })
    connection.ws = ws

    ws.on('open', () => {
      connection.attempt = 0
      connection.wsDownSince = null
      connection.seq = 0
      for (const payload of connection.outbox.splice(0)) ws.send(payload)
      this.setState(connection, 'online')
      this.startHeartbeat(connection, ws)
    })
    ws.on('pong', () => {
      connection.missedPongs = 0
      connection.lastSeenAt = Date.now()
    })
    ws.on('message', (data) => this.receive(connection, data.toString()))
    ws.on('unexpected-response', (_req, res) => {
      // 401/403 at the upgrade means the device was revoked or the token is wrong. Stop reconnecting:
      // retrying a revoked credential forever is noise, and the UI needs to say so.
      if (res.statusCode === 401 || res.statusCode === 403) {
        this.setState(connection, 'revoked', { code: 'unauthorized' })
        connection.closed = true
        return
      }
      this.scheduleReconnect(connection)
    })
    ws.on('error', (error) => this.noteSocketError(connection, error))
    ws.on('close', () => {
      this.stopHeartbeat(connection)
      if (connection.wsDownSince === null) connection.wsDownSince = Date.now()
      this.scheduleReconnect(connection)
    })
  }

  // Ping on an interval; a peer that misses two in a row is treated as gone.
  //
  // `terminate()` rather than `close()`, and that is the whole point: `close()` starts a closing
  // HANDSHAKE, which waits for a reply from the peer we have just concluded is not replying. The socket
  // would sit in CLOSING and the node would still read `online` — the exact bug this exists to fix, one
  // state further along. `terminate()` destroys it, which fires `'close'`, which reaches the reconnect
  // and state machinery already there.
  private startHeartbeat(connection: Connection, ws: WebSocket): void {
    this.stopHeartbeat(connection)
    connection.missedPongs = 0
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      // Checked BEFORE sending, so the count read here is of pings that have already had a full interval
      // to be answered. Incrementing first and checking after would condemn the socket on a ping that had
      // not been given its chance yet.
      if (connection.missedPongs >= MISSED_PONGS_BEFORE_DEAD) {
        console.warn(`[broker] ${connection.node.nodeId} left ${connection.missedPongs} pings unanswered; treating it as unreachable`)
        ws.terminate()
        return
      }
      connection.missedPongs += 1
      try {
        ws.ping()
      } catch {
        ws.terminate() // a socket that cannot even be pinged is not a socket we are waiting on
      }
    }, this.pingIntervalMs)
    timer.unref?.()
    connection.pingTimer = timer
  }

  private stopHeartbeat(connection: Connection): void {
    if (connection.pingTimer) clearInterval(connection.pingTimer)
    connection.pingTimer = null
    connection.missedPongs = 0
  }

  private receive(connection: Connection, raw: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(raw)
    } catch {
      return // a frame we cannot parse is a frame we cannot act on
    }
    connection.lastSeenAt = Date.now()
    const seq = (frame as { seq?: unknown }).seq
    if (typeof seq === 'number') {
      // A gap means loss. The protocol's remedy is to treat it as a reconnect, because there is no
      // cursor into history to replay from — the client refetches instead.
      if (connection.seq !== 0 && seq !== connection.seq + 1) {
        console.warn(`[broker] frame gap on ${connection.node.nodeId}: expected ${connection.seq + 1}, got ${seq}`)
        connection.ws?.close()
        return
      }
      connection.seq = seq
    }
    this.events.frame(connection.node.nodeId, frame)
  }

  private scheduleReconnect(connection: Connection): void {
    if (connection.closed || connection.reconnectTimer) return
    connection.ws = null
    this.setState(connection, this.downState(connection), connection.error)
    const base = BACKOFF_MS[Math.min(connection.attempt, BACKOFF_MS.length - 1)]
    // Jitter so several nodes coming back from a laptop sleep do not reconnect in lockstep.
    const delay = base * (1 + (Math.random() * 2 - 1) * JITTER)
    connection.attempt += 1
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null
      // Re-probed, not just re-opened, and this is the case the gate actually exists for: a node that
      // upgrades restarts, which drops the socket, so reconnect is the moment its new major arrives. A
      // probe only at upsert would notice a version that changed while the app was closed and miss the
      // one that changed while it was open.
      void this.openConnection(connection)
    }, delay)
  }

  // WS down but HTTP recently fine ⇒ degraded, not offline: the node is there, we just have no live
  // events, and the UI should say "stale" rather than "gone".
  private downState(connection: Connection): NodeConnectionState {
    if (connection.state === 'revoked' || connection.state === 'incompatible') return connection.state
    const downFor = connection.wsDownSince ? Date.now() - connection.wsDownSince : 0
    const httpRecent = connection.lastHttpOkAt !== null && Date.now() - connection.lastHttpOkAt < DEGRADED_AFTER_MS * 2
    return httpRecent && downFor >= DEGRADED_AFTER_MS ? 'degraded' : 'offline'
  }

  // Only the AUTH GATE's own answer is evidence that this device was revoked, and the gate says exactly
  // one thing: 401 with `unauthenticated` (server/middleware/requireUser.ts — a revoked token resolves to
  // no principal, indistinguishably from an unknown one).
  //
  // Reading the status alone was wrong, and wrong in the direction that matters. Route-level failures
  // reuse both codes for a DIFFERENT credential: `provider_not_connected` is a 403 and is what a fresh
  // node answers for a GitHub integration nobody has connected yet, and `linear_reauth` /
  // `provider_needs_auth` are 401s about a third-party token. The loopback Host guard also 403s. Any one
  // of them marked a perfectly healthy node `revoked` — which the fleet UI renders as a security event
  // and which stops the WebSocket being retried.
  private noteHttpResult(connection: Connection, response: NodeFetchResponse): void {
    if (response.status === 401 && errorCodeOf(response) === 'unauthenticated') {
      this.setState(connection, 'revoked', { code: 'unauthorized' })
      return
    }
    connection.lastHttpOkAt = Date.now()
    connection.lastSeenAt = Date.now()
    if (connection.state === 'offline') this.setState(connection, connection.ws ? 'online' : 'degraded')
  }

  private noteHttpFailure(connection: Connection, error: unknown): void {
    const mismatch = isPinMismatch(error)
    this.setState(
      connection,
      'offline',
      mismatch ? { code: 'identity_mismatch' } : { code: 'unreachable' },
    )
  }

  private noteSocketError(connection: Connection, error: unknown): void {
    if (isPinMismatch(error)) {
      // A changed fingerprint is a hard security stop (docs/security.md), never an auto-retrust:
      // stop reconnecting so the UI must involve the owner.
      connection.closed = true
      this.setState(connection, 'offline', { code: 'identity_mismatch' })
    }
  }

  private setState(connection: Connection, state: NodeConnectionState, error?: NodeStatus['error']): void {
    if (connection.state === state && connection.error?.code === error?.code) return
    connection.state = state
    connection.error = state === 'online' ? undefined : error
    this.events.status(this.statusOf(connection))
  }

  private statusOf(connection: Connection): NodeStatus {
    return {
      nodeId: connection.node.nodeId,
      state: connection.state,
      ...(connection.error ? { error: connection.error } : {}),
      ...(connection.lastSeenAt !== null ? { lastSeenAt: connection.lastSeenAt } : {}),
    }
  }

  private pinning(node: BrokerNode): PinnedTlsOptions {
    return pinnedTlsOptions(node.fingerprint, node.certPem)
  }
}

type HttpsAgentIdentityCheck = (host: string, cert: { fingerprint256: string }) => Error | undefined
export type PinnedTlsOptions = { ca?: string[]; rejectUnauthorized: boolean; checkServerIdentity?: HttpsAgentIdentityCheck }

// Certificate pinning (docs/api-reference.md § Transport and identity: "No CA, no hostname
// validation — the pin is the identity").
//
// `rejectUnauthorized` MUST stay true. In false mode Node does not call checkServerIdentity at all,
// so the pin would silently never be checked — a failure that fails OPEN. Supplying the node's own
// self-signed certificate as the CA is what makes the chain valid; the override then replaces
// hostname verification with the fingerprint comparison.
//
// Exported because pairing performs the very first authenticated request to a node before the broker
// has heard of it (nodePairing.ts), and a second copy of this would be a second thing to get wrong.
export function pinnedTlsOptions(fingerprint: string | undefined, certPem: string | undefined): PinnedTlsOptions {
  if (!fingerprint || !certPem) return { rejectUnauthorized: true }
  const expected = normalizeFingerprint(fingerprint)
  return {
    ca: [certPem],
    rejectUnauthorized: true,
    checkServerIdentity: (_host, cert) =>
      normalizeFingerprint(cert.fingerprint256) === expected
        ? undefined
        : Object.assign(new Error('acorn: node certificate fingerprint mismatch'), { code: PIN_MISMATCH_CODE }),
  }
}

export const PIN_MISMATCH_CODE = 'ACORN_PIN_MISMATCH'

export const normalizeFingerprint = (value: string): string => value.replace(/:/g, '').toLowerCase()

// The `error.code` out of the node's error envelope (docs/api-reference.md § Errors), or null if this
// response is not one. Only consulted for a 401, so parsing a body here costs nothing on the happy path.
const errorCodeOf = (response: NodeFetchResponse): string | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { error?: { code?: unknown } }
    return typeof parsed?.error?.code === 'string' ? parsed.error.code : null
  } catch {
    return null
  }
}

// nodeRequest.ts raises the DOM-shaped `AbortError`; `ws`/undici-style aborts carry the same name.
const isAbort = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'AbortError'

const isPinMismatch = (error: unknown): boolean => {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === PIN_MISMATCH_CODE) return true
  }
  return false
}
