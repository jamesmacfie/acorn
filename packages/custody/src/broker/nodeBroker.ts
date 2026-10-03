import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { WebSocket } from 'ws'
import { nodeRequest } from './nodeRequest'
import { MAX_NODE_WS_MESSAGE_BYTES, decodeIdFrame, WS_PATH, WS_VIEWERS_HEADER, wsViewerIdSchema, type WsClientFrame, type WsSendOptions } from '@acorn/protocol/ws.ts'
import { NODE_PROTOCOL_VERSION, nodeInfoSchema } from '@acorn/protocol/node.ts'
import {
  type NodeConnectionState,
  type NodeFetchRequest,
  type NodeFetchResponse,
  type NodeRecord,
  type NodeStatus,
  type NodeTransportError,
} from '@acorn/protocol/broker.ts'
import { EventViewers } from './eventViewers'
import { BrokerFetch } from './brokerFetch'
import { emitEvent, telemetryEnabled } from '@acorn/node-core/server/telemetry'
import { createLogger } from '@acorn/node-core/server/telemetry'

// What the broker reports, and it is health rather than traffic (docs/shell/node-child.md § What the helper
// reports). `broker.request` is a histogram because a renderer's reads run far past ten a second;
// the four events are the moments a person would want a timestamp for, and each carries the node id
// so a fleet view of slow or flapping nodes is a query rather than a bisect.
const log = createLogger('broker')

// The connection broker. See docs/shell.md, "Connection broker", for what it owns per node. It has
// no shell binding, so it can be unit-tested against a real TLS server.
// `apps/desktop/src/shell/helperServer.ts` exposes it to the renderer.
//
// It must not live in @acorn/client-core. The boundary test classifies that package as client-side,
// so a node:https import there would fail the client/node split rule and drag Node builtins into the
// renderer bundle.

// Reconnect backoff. See docs/architecture/fleet.md § Deadlines. Capped so a node that is
// off for the night is retried every 30s rather than every 16.
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
const JITTER = 0.2
// A WS that has been down this long while HTTP still works is `degraded`, not `offline`.
const DEGRADED_AFTER_MS = 5_000
const PING_INTERVAL_MS = 15_000
// Two intervals of silence, not one. A single missed pong on a congested link is not evidence, and
// being wrong costs a working socket and a refetch of everything on it.
const MISSED_PONGS_BEFORE_DEAD = 2
// Short, because this sits in front of the socket on every connect and a slow node must not delay
// the reconnect. Timing out here reads as "no clear answer" and the socket opens.
const PROTOCOL_PROBE_TIMEOUT_MS = 5_000
const PROTOCOL_PROBE_MAX_BYTES = 16 * 1024
// ws enforces this while assembling (including inflated messages), before toString/JSON.parse or
// the helper IPC boundary can make another copy. A malicious node must not pick the allocation size.
export { MAX_NODE_WS_MESSAGE_BYTES } from '@acorn/protocol/ws.ts'
const MAX_NODE_HTTP_SOCKETS = 4

// A node plus the material only main may hold: the bearer, and the certificate to pin against.
export type BrokerNode = NodeRecord & { token: string; certPem?: string }

export type BrokerEvents = {
  // A server→client frame arrived. Forwarded verbatim; the broker does not interpret channels.
  frame(nodeId: string, frame: unknown, viewerId?: string): void
  // The one binary frame: terminal output, as an id-tagged payload (@acorn/protocol/ws.ts § The one
  // binary frame). Forwarded byte for byte — this broker does not read the id inside and does not
  // count the frame against `seq`, because a binary frame takes no sequence number.
  bytes(nodeId: string, frame: Uint8Array, viewerId?: string): void
  transportError?(nodeId: string, error: NodeTransportError, viewerId?: string): void
  status(status: NodeStatus): void
}

type Connection = {
  node: BrokerNode
  agent: HttpAgent | HttpsAgent
  ws: WebSocket | null
  // Frames the renderer sent before the socket was open. Kept here as well as in the renderer's own
  // outbox, because a reconnect happens inside main and the renderer never learns of it.
  viewers: EventViewers
  state: NodeConnectionState
  error: NodeStatus['error']
  attempt: number
  reconnectTimer: NodeJS.Timeout | null
  // The heartbeat's timer and miss counter. Per connection, because nodes are on different links and
  // a slept laptop must not condemn the loopback node beside it.
  pingTimer: NodeJS.Timeout | null
  missedPongs: number
  wsDownSince: number | null
  lastHttpOkAt: number | null
  lastSeenAt: number | null
  // Per-connection monotonic counter from the server. A gap means frames were lost, which the
  // protocol says to treat as a reconnect. See docs/api-reference.md, "Events".
  seq: number
  closed: boolean
}

export class NodeBroker {
  private readonly connections = new Map<string, Connection>()
  private readonly requests = new BrokerFetch()
  private readonly pingIntervalMs: number
  private readonly viewerMultiplexing: boolean

  // The heartbeat cadence is injectable so the interval runs for real in tests and the assertion is
  // that the socket died, not that a timer was scheduled.
  constructor(
    private readonly events: BrokerEvents,
    options: { pingIntervalMs?: number; viewerMultiplexing?: boolean } = {},
  ) {
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS
    this.viewerMultiplexing = options.viewerMultiplexing ?? false
  }

  // Add or replace a node. Replacing tears the old connection down first, so a re-pair with a new
  // token or a moved endpoint cannot leave a socket on the previous credential.
  upsert(node: BrokerNode): void {
    this.remove(node.nodeId)
    const agent = node.endpoint.startsWith('https:')
      ? new HttpsAgent({ keepAlive: true, maxSockets: MAX_NODE_HTTP_SOCKETS, ...this.pinning(node) })
      : new HttpAgent({ keepAlive: true, maxSockets: MAX_NODE_HTTP_SOCKETS })
    const connection: Connection = {
      node,
      agent,
      ws: null,
      viewers: new EventViewers((viewerId, error) => this.events.transportError?.(node.nodeId, error, viewerId)),
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

  // The version gate runs here rather than at pairing, because pairing checks once and a node
  // upgrades afterward. A node that drifted past this client used to keep connecting and fail later
  // as an `undefined` deep inside a component.
  //
  // It runs before the socket opens. A client that cannot speak the protocol should not open a
  // WebSocket and start interpreting frames on it.
  //
  // Failing to reach the node is not a version failure. It is the ordinary offline path, and marking
  // a sleeping laptop incompatible would be sticky and alarming. Only a definite, parseable,
  // different major stops the connection. Anything else opens the socket and lets the reconnect
  // machinery answer.
  private async openConnection(connection: Connection): Promise<void> {
    if (connection.closed) return
    const compatible = await this.probeProtocol(connection)
    if (connection.closed) return
    if (compatible === false) {
      // Sticky, like `revoked`. Retrying cannot fix a version, and `downState` refuses to downgrade
      // either state. Only an upsert clears it, which is when the answer could have changed.
      this.setState(connection, 'incompatible', { code: 'protocol_mismatch' })
      connection.closed = true
      return
    }
    this.openSocket(connection)
  }

  // The node's own claim, over the pinned agent. Unauthenticated `GET /v1/node`, because asking for a
  // token here would confuse "your device was revoked" with "we disagree about the protocol".
  //
  // Returns null for anything that is not a clear answer: unreachable, non-JSON, or a body without a
  // numeric protocol. The schema is additive-forever, so a newer node still parses. If it does not,
  // the raw field is read anyway, because a client that refuses to learn a version from a partly
  // parsed response cannot explain itself.
  private async probeProtocol(connection: Connection): Promise<boolean | null> {
    connection.viewers.setTransport(false)
    try {
      const response = await nodeRequest({
        url: new URL('/v1/node', connection.node.endpoint),
        method: 'GET',
        // No authorization header. This is the pre-auth identity route, and sending the bearer would
        // let a revoked device read "unauthorized" as a version disagreement.
        headers: {},
        agent: connection.agent,
        signal: AbortSignal.timeout(PROTOCOL_PROBE_TIMEOUT_MS),
        maxResponseBytes: PROTOCOL_PROBE_MAX_BYTES,
      })
      if (response.status !== 200) return null
      const payload: unknown = JSON.parse(new TextDecoder().decode(response.body))
      const parsed = nodeInfoSchema.safeParse(payload)
      if (parsed.success) {
        connection.viewers.setTransport(this.viewerMultiplexing && parsed.data.eventTransport?.viewers === 1)
        return parsed.data.protocolVersion === NODE_PROTOCOL_VERSION
      }
      const claimed = (payload as { protocolVersion?: unknown } | null)?.protocolVersion
      // A parseable Acorn claim without the baseline is a definite incompatibility, not an offline node.
      return typeof claimed === 'number' ? false : null
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
    connection.viewers.clear()
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
    this.requests.dispose()
  }

  // --- HTTP ---

  async fetch(nodeId: string, request: NodeFetchRequest, limits: { maxResponseBytes?: number } = {}): Promise<NodeFetchResponse> {
    const connection = this.connections.get(nodeId)
    if (!connection) throw new Error(`Unknown node ${nodeId}`)
    // Types do not validate a helper message at runtime. In particular `//host/path` is accepted by
    // startsWith('/') but changes the origin when joined with the node endpoint. Never send the
    // paired-node bearer to an authority chosen by a path from the renderer.
    if (!request.path.startsWith('/') || request.path.startsWith('//') || request.path.includes('\\') || request.path.includes('#')) {
      throw new Error('Node request path must stay on the paired node.')
    }
    const target = new URL(request.path, connection.node.endpoint)
    if (target.origin !== new URL(connection.node.endpoint).origin) {
      throw new Error('Node request path must stay on the paired node.')
    }

    return this.requests.fetch(nodeId, request, connection, {
      result: (response) => this.noteHttpResult(connection, response),
      failure: (error) => this.noteHttpFailure(connection, error),
    }, limits)
  }

  abort(requestId: string): void { this.requests.abort(requestId) }

  // --- WebSocket ---

  send(nodeId: string, frame: WsClientFrame, options: WsSendOptions & { viewerId?: string } = {}): boolean {
    const connection = this.connections.get(nodeId)
    if (!connection) return false
    const viewerId = options.viewerId ?? connection.viewers.defaultId
    if (!wsViewerIdSchema.safeParse(viewerId).success) throw new Error('Invalid event viewer ID.')
    const entry = connection.viewers.track(viewerId, frame, options.intent, options.cleanup)
    if (!entry) return false
    if (connection.ws?.readyState === WebSocket.OPEN) {
      const payload = connection.viewers.wire(entry)
      if (payload) connection.ws.send(payload)
    } else connection.viewers.outbox.push(entry)
    return true
  }

  openViewer(nodeId: string, viewerId: string): boolean {
    return this.send(nodeId, { channel: 'ws:viewer-open' }, { viewerId, intent: { key: 'ws:viewer', state: 'attached' } })
  }

  closeViewer(nodeId: string, viewerId?: string): void {
    const connection = this.connections.get(nodeId)
    if (!connection) return
    const id = viewerId ?? connection.viewers.defaultId
    const resetLegacy = connection.viewers.retire(id)
    if (connection.ws?.readyState !== WebSocket.OPEN) return
    if (connection.viewers.multiplexed) connection.ws.send(JSON.stringify({ channel: 'ws:viewer-close', viewerId: id }))
    else if (resetLegacy) connection.ws.terminate()
  }

  private openSocket(connection: Connection): void {
    if (connection.closed) return
    const url = new URL(WS_PATH, connection.node.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // The bearer rides the upgrade request's headers, which a browser cannot set. One reason the
    // socket belongs to main rather than the renderer.
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${connection.node.token}`, ...(connection.viewers.multiplexed ? { [WS_VIEWERS_HEADER]: '1' } : {}) },
      agent: connection.agent,
      maxPayload: MAX_NODE_WS_MESSAGE_BYTES,
      perMessageDeflate: false,
    })
    connection.ws = ws

    ws.on('open', () => {
      if (connection.closed || connection.ws !== ws) return
      connection.attempt = 0
      connection.wsDownSince = null
      connection.seq = 0
      for (const entry of connection.viewers.outbox.drain()) {
        const payload = connection.viewers.wire(entry)
        if (payload) ws.send(payload)
      }
      this.setState(connection, 'online')
      this.startHeartbeat(connection, ws)
    })
    ws.on('pong', () => {
      connection.missedPongs = 0
      connection.lastSeenAt = Date.now()
    })
    ws.on('message', (data, isBinary) => {
      if (connection.closed || connection.ws !== ws) return
      if (isBinary) return this.receiveBytes(connection, data)
      this.receive(connection, data.toString())
    })
    ws.on('unexpected-response', (_req, res) => {
      // 401 or 403 at the upgrade means the device was revoked or the token is wrong. Stop
      // reconnecting, because retrying a revoked credential forever is noise.
      if (res.statusCode === 401 || res.statusCode === 403) {
        this.setState(connection, 'revoked', { code: 'unauthorized' })
        connection.closed = true
        return
      }
      this.scheduleReconnect(connection)
    })
    ws.on('error', (error) => this.noteSocketError(connection, error))
    ws.on('close', () => {
      if (connection.ws !== ws) return
      this.stopHeartbeat(connection)
      if (connection.wsDownSince === null) connection.wsDownSince = Date.now()
      this.scheduleReconnect(connection)
    })
  }

  // Ping on an interval. A peer that misses two in a row is treated as gone.
  //
  // `terminate()` rather than `close()`. `close()` starts a closing handshake, which waits for a
  // reply from a peer already concluded to be not replying: the socket sits closing and the node
  // still reads `online`, which is the bug this exists to fix, one state further along.
  // `terminate()` destroys it, which fires `'close'` and reaches the reconnect machinery.
  private startHeartbeat(connection: Connection, ws: WebSocket): void {
    this.stopHeartbeat(connection)
    connection.missedPongs = 0
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      // Checked before sending, so the count covers pings that already had a full interval to be
      // answered. Incrementing first would condemn the socket on a ping that never had its chance.
      if (connection.missedPongs >= MISSED_PONGS_BEFORE_DEAD) {
        log.warn(`${connection.node.nodeId} left ${connection.missedPongs} pings unanswered; treating it as unreachable`, { 'node.id': connection.node.nodeId })
        emitEvent('core', 'broker.missed-pong', { 'node.id': connection.node.nodeId, missed: connection.missedPongs })
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

  // `ws` hands a binary message over as a Buffer, or as an array of them when the frame was
  // fragmented. Concatenated rather than forwarded piecemeal, because the id and the payload have to
  // reach the other end as one frame.
  private receiveBytes(connection: Connection, data: unknown): void {
    connection.lastSeenAt = Date.now()
    const frame = Array.isArray(data) ? Buffer.concat(data as Buffer[]) : (data as Buffer)
    if (!connection.viewers.multiplexed) return this.events.bytes(connection.node.nodeId, frame, connection.viewers.legacyRecipient())
    const tagged = decodeIdFrame(frame)
    if (!tagged || !wsViewerIdSchema.safeParse(tagged.id).success) return
    this.events.bytes(connection.node.nodeId, tagged.payload, connection.viewers.externalId(tagged.id))
  }

  private receive(connection: Connection, raw: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(raw)
    } catch {
      return // a frame we cannot parse is a frame we cannot act on
    }
    if (!frame || typeof frame !== 'object') return
    connection.lastSeenAt = Date.now()
    const seq = (frame as { seq?: unknown }).seq
    // `ws:shed` is the node saying "you were behind, so I dropped some invalidation frames". Shed
    // load, not lost data: the node's hub takes a sequence number for the marker so there is normally
    // no gap at all, and where there is one, closing would be the wrong answer twice over — a reconnect
    // re-attaches every terminal and refetches every active query at the moment the node is busiest
    // (docs/terminal/activity.md § Backpressure). The frame is forwarded either way, and the renderer answers it
    // by marking what it is showing stale.
    const shed = (frame as { channel?: unknown }).channel === 'ws:shed'
    if (typeof seq === 'number') {
      // A gap means loss. There is no cursor into history to replay from, so the protocol's remedy is
      // to treat it as a reconnect and refetch.
      if (connection.seq !== 0 && seq !== connection.seq + 1) {
        if (!shed) {
          log.warn(`frame gap on ${connection.node.nodeId}: expected ${connection.seq + 1}, got ${seq}`, { 'node.id': connection.node.nodeId })
          connection.ws?.close()
          return
        }
        log.warn(`${connection.node.nodeId} shed frames under load: expected ${connection.seq + 1}, got ${seq}`, { 'node.id': connection.node.nodeId })
        emitEvent('core', 'broker.shed', { 'node.id': connection.node.nodeId, missing: seq - connection.seq - 1 })
      }
      connection.seq = seq
    }
    const routed = frame as { channel?: unknown; viewerId?: unknown; frame?: unknown }
    if (connection.viewers.multiplexed && routed.channel === 'ws:viewer' && typeof routed.viewerId === 'string') {
      if (!wsViewerIdSchema.safeParse(routed.viewerId).success) return
      this.events.frame(connection.node.nodeId, routed.frame, connection.viewers.externalId(routed.viewerId))
    } else if (connection.viewers.multiplexed && routed.channel === 'ws:viewer-error') {
      const error = frame as { viewerId?: unknown; code?: unknown; message?: unknown }
      if (typeof error.viewerId === 'string' && wsViewerIdSchema.safeParse(error.viewerId).success && (error.code === 'viewer_limit' || error.code === 'viewers_unsupported') && typeof error.message === 'string') {
        this.events.transportError?.(connection.node.nodeId, { code: error.code, message: error.message }, connection.viewers.externalId(error.viewerId))
      }
    } else this.events.frame(connection.node.nodeId, frame, connection.viewers.multiplexed ? undefined : connection.viewers.legacyRecipient())
  }

  private scheduleReconnect(connection: Connection): void {
    if (connection.closed || connection.reconnectTimer) return
    connection.ws = null
    connection.viewers.reconnect()
    this.setState(connection, this.downState(connection), connection.error)
    const base = BACKOFF_MS[Math.min(connection.attempt, BACKOFF_MS.length - 1)]
    // Jitter so several nodes coming back from a laptop sleep do not reconnect in lockstep.
    const delay = base * (1 + (Math.random() * 2 - 1) * JITTER)
    connection.attempt += 1
    if (telemetryEnabled()) {
      emitEvent('core', 'broker.reconnect', { 'node.id': connection.node.nodeId, attempt: connection.attempt, 'delay.ms': Math.round(delay) })
    }
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null
      // Re-probed, not just re-opened. A node that upgrades restarts, which drops the socket, so
      // reconnect is the moment its new major arrives. A probe only at upsert would miss a version
      // that changed while the app was open.
      void this.openConnection(connection)
    }, delay)
  }

  // WS down but HTTP recently fine means degraded, not offline. The node is there and only the live
  // events are missing, so the UI says "stale" rather than "gone".
  private downState(connection: Connection): NodeConnectionState {
    if (connection.state === 'revoked' || connection.state === 'incompatible') return connection.state
    const downFor = connection.wsDownSince ? Date.now() - connection.wsDownSince : 0
    const httpRecent = connection.lastHttpOkAt !== null && Date.now() - connection.lastHttpOkAt < DEGRADED_AFTER_MS * 2
    return httpRecent && downFor >= DEGRADED_AFTER_MS ? 'degraded' : 'offline'
  }

  // Only the auth gate's own answer is evidence that this device was revoked, and it says one thing:
  // 401 with `unauthenticated`. See server/middleware/requireUser.ts, where a revoked token resolves
  // to no principal.
  //
  // Reading the status alone was wrong in the direction that matters. Route-level failures reuse both
  // codes for a different credential: `provider_not_connected` is the 403 a fresh node answers for an
  // unconnected GitHub integration, and `linear_reauth` and `provider_needs_auth` are 401s about a
  // third-party token. The loopback Host guard also 403s. Any of them marked a healthy node
  // `revoked`, which the fleet UI renders as a security event and which stops the WebSocket being
  // retried.
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
    if ((error as { code?: unknown } | null)?.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
      // A peer violating the message ceiling can otherwise make us receive and reject another
      // allocation on every reconnect. Keep it offline until the owner reconnects this node.
      connection.closed = true
      connection.ws?.terminate()
      this.setState(connection, 'offline', { code: 'unreachable' })
      log.warn(`${connection.node.nodeId} sent a WebSocket message over the client limit`, { 'node.id': connection.node.nodeId })
      return
    }
    if (isPinMismatch(error)) {
      // A changed fingerprint is a hard security stop, never an auto-retrust. See docs/security.md.
      // Stop reconnecting so the UI has to involve the owner.
      connection.closed = true
      this.setState(connection, 'offline', { code: 'identity_mismatch' })
    }
  }

  private setState(connection: Connection, state: NodeConnectionState, error?: NodeStatus['error']): void {
    if (connection.state === state && connection.error?.code === error?.code) return
    connection.state = state
    connection.error = state === 'online' ? undefined : error
    // `degraded` is the one state worth an event of its own: the socket is down and HTTP still
    // works, so nothing in the app is broken and nothing in the app says so either. The other four
    // are already visible — `online` is the absence of a problem, and `offline`, `revoked` and
    // `incompatible` all reach a person as a screen.
    if (state === 'degraded') emitEvent('core', 'broker.degraded', { 'node.id': connection.node.nodeId })
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

// Certificate pinning. See docs/security.md, "Transport and auth".
//
// `rejectUnauthorized` must stay true. In false mode Node never calls checkServerIdentity, so the pin
// is never checked and the failure is open. Supplying the node's own self-signed certificate as the
// CA is what makes the chain valid, and the override replaces hostname verification with the
// fingerprint comparison.
//
// Exported because pairing makes the first authenticated request to a node before the broker has
// heard of it. See nodePairing.ts.
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

// The `error.code` out of the node's error envelope, or null if this response is not one. Only
// consulted for a 401, so parsing a body costs nothing on the happy path.
const errorCodeOf = (response: NodeFetchResponse): string | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { error?: { code?: unknown } }
    return typeof parsed?.error?.code === 'string' ? parsed.error.code : null
  } catch {
    return null
  }
}

const isPinMismatch = (error: unknown): boolean => {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === PIN_MISMATCH_CODE) return true
  }
  return false
}
