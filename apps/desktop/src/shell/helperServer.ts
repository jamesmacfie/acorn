import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import {
  nodeFetchRequestSchema,
  nodeForgetRequestSchema,
  nodePairRequestSchema,
  nodeProbeRequestSchema,
  nodeRenameRequestSchema,
  nodeTunnelRequestSchema,
  type NodeProbeResult,
  type NodeRecord,
} from '@acorn/protocol/broker.ts'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'
import type { Helper } from '@acorn/desktop-helper/main/index.ts'
import { toNodeRecord } from '@acorn/desktop-helper/main/fleetStore.ts'
import { pairWithNode, probeNode } from '@acorn/desktop-helper/main/nodePairing.ts'
import { decodeBytes, encodeBytes, type HelperMessage, type HelperMethod, type HelperPush, type HelperRequest, type WireFetchRequest } from './wire'
import {
  decisionSchema,
  devGrantSchema,
  disclosureSchema,
  NO_DISCLOSURE,
  putSchema,
  type PluginsState,
} from '@acorn/desktop-helper/main/pluginRequests.ts'

// The renderer's projection of the custody stack, over one loopback WebSocket. This is the Tauri half
// of what Electron's `nodeBrokerIpc.ts` and `pluginIpc.ts` were: same
// vocabulary, same Zod parsing, same "every decision lives in @acorn/desktop-helper and this file only
// validates and forwards" rule. Read those two files for why each decision is where it is; this one
// deliberately restates none of it.
//
// Two things are Tauri-specific and load-bearing:
//
// The gate is the secret, not the origin. The helper binds an ephemeral loopback port and mints a
// 32-byte secret that only Rust and, through one capability-scoped Tauri command, the renderer ever
// see. A browser cannot set headers on a WebSocket handshake, so it arrives in the query string; the
// Origin check beside it is defence in depth, because any local process could open a socket here and
// claim any origin it liked.
//
// Nothing else is served. There is no HTTP surface at all — the listener exists to be upgraded, and a
// plain request gets 426. That keeps the widened `connect-src` in the renderer CSP down to a
// WebSocket origin (docs/shell.md § Renderer origin and protocol handler).

export type HelperServer = {
  port: number
  secret: string
  // Broker pushes and the node-replaced signal, fanned out to whatever renderer is attached. Held as a
  // method on the server rather than captured at construction for the same reason Electron holds its
  // push target as a function of the window: there may be no renderer yet, and there may be a
  // different one later.
  push(message: HelperPush): void
  close(): Promise<void>
}

const HELPER_PATH = '/helper'

// Constant-time, and length-checked first because timingSafeEqual throws on a length mismatch.
const secretMatches = (expected: string, presented: string | null): boolean => {
  if (!presented || presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
}

const toFetchRequest = (wire: WireFetchRequest): unknown => {
  const { body, ...rest } = wire
  if (!body) return rest
  if (body.kind === 'bytes') return { ...rest, body: { kind: 'bytes', bytes: decodeBytes(body.bytes) } }
  return {
    ...rest,
    body: {
      kind: 'form',
      parts: body.parts.map((part) => ('filename' in part ? { ...part, bytes: decodeBytes(part.bytes) } : part)),
    },
  }
}

export function startHelperServer(helper: Helper, options: { secret: string; appOrigin: string }): Promise<HelperServer> {
  const { secret, appOrigin } = options
  const sockets = new Set<WebSocket>()

  const push = (message: HelperMessage): void => {
    const payload = JSON.stringify(message)
    for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(payload)
  }

  // Bring a remembered node's connection up (or back up). Idempotent, so this doubles as the Reconnect
  // button's implementation. No token means no cipher on this machine: the node stays listed so the
  // owner can see it and re-pair, and reads as `offline`.
  const connect = (nodeId: string): void => {
    const node = helper.fleet.get(nodeId)
    const token = node && helper.fleet.tokenFor(nodeId)
    if (!node || !token) return
    helper.broker.upsert({ ...toNodeRecord(node), token, ...(node.certPem ? { certPem: node.certPem } : {}) })
  }

  // The probe is remembered here rather than returned to the renderer, which is what forces the
  // fingerprint confirmation to be a step instead of a parameter the renderer could skip.
  let pending: Awaited<ReturnType<typeof probeNode>> | null = null

  const handlers: Record<HelperMethod, (params: unknown) => unknown | Promise<unknown>> = {
    'node-fetch': async (raw) => {
      const { nodeId, request } = z.object({ nodeId: z.string().min(1), request: z.unknown() }).parse(raw)
      const parsed = nodeFetchRequestSchema.parse(toFetchRequest(request as WireFetchRequest))
      try {
        const response = await helper.broker.fetch(nodeId, parsed)
        return { status: response.status, headers: response.headers, body: encodeBytes(response.body) }
      } catch (error) {
        // A request the renderer itself cancelled is not a handler failure; 499 says the caller has
        // already stopped caring. The broker renames its own timeout abort so the two stay apart.
        if ((error as { name?: unknown } | null)?.name === 'AbortError') return { status: 499, headers: {}, body: '' }
        throw error
      }
    },
    'node-abort': (raw) => {
      const { requestId } = z.object({ requestId: z.string().min(1) }).parse(raw)
      helper.broker.abort(requestId)
    },
    'node-send': (raw) => {
      const { nodeId, frame } = z.object({ nodeId: z.string().min(1), frame: z.unknown() }).parse(raw)
      // Structural check only: the frame vocabulary is a
      // TypeScript union rather than a Zod schema, the node validates its own inbound frames, and all
      // the helper needs to know is that this is a channel-tagged object it can forward.
      if (!frame || typeof frame !== 'object' || typeof (frame as { channel?: unknown }).channel !== 'string') return
      helper.broker.send(nodeId, frame as WsClientFrame)
    },
    // Membership from the fleet store, connection state from the broker: a node whose token could not
    // be remembered has no connection but must still be listed, or it can never be re-paired.
    'fleet-list': () => ({ nodes: helper.fleet.list().map(toNodeRecord), statuses: helper.broker.statuses() }),
    'node-probe': async (raw): Promise<NodeProbeResult> => {
      const { endpoint } = nodeProbeRequestSchema.parse(raw)
      const probe = await probeNode(endpoint)
      pending = probe
      const { certPem: _certPem, ...result } = probe
      return result
    },
    'node-pair': async (raw): Promise<NodeRecord> => {
      const request = nodePairRequestSchema.parse(raw)
      const probe = pending
      if (!probe) throw new Error('Confirm the node fingerprint before pairing.')
      if (!probe.compatible) throw new Error('That node speaks a different protocol version.')
      const result = await pairWithNode(probe, { code: request.code, deviceName: request.deviceName })
      pending = null
      const node = helper.fleet.remember(
        {
          nodeId: result.nodeId,
          label: request.label,
          endpoint: probe.endpoint,
          fingerprint: probe.fingerprint,
          certPem: probe.certPem,
          deviceId: result.device.id,
          local: false,
        },
        result.deviceToken,
      )
      connect(node.nodeId)
      return toNodeRecord(node)
    },
    'node-rename': (raw): NodeRecord | null => {
      const { nodeId, label } = nodeRenameRequestSchema.parse(raw)
      const node = helper.fleet.rename(nodeId, label)
      if (!node) return null
      // The label rides in the broker's record too, so keep the live connection's copy in step rather
      // than waiting for the next launch.
      connect(nodeId)
      return toNodeRecord(node)
    },
    'node-forget': async (raw): Promise<void> => {
      const { nodeId, revoke } = nodeForgetRequestSchema.parse(raw)
      const node = helper.fleet.get(nodeId)
      if (!node) return
      if (node.local) throw new Error('The local node cannot be removed.')
      if (revoke && node.deviceId) {
        // The last request that will ever authenticate, and it closes our own socket. A failure must
        // not abort the local forget: the usual reason revoke fails is that the node is offline.
        await helper.broker
          .fetch(nodeId, { requestId: `forget-${nodeId}`, path: `/v2/core/devices/${node.deviceId}`, method: 'DELETE', headers: {} })
          .catch((error: unknown) => console.warn(`[fleet] could not revoke this device on ${nodeId}:`, error))
      }
      helper.broker.remove(nodeId)
      helper.fleet.forget(nodeId)
      // A pipe to a node we have just stopped trusting must not outlive the pairing.
      helper.tunnels.closeFor({ nodeId })
    },
    'node-reconnect': (raw) => {
      const { nodeId } = z.object({ nodeId: z.string().min(1) }).parse(raw)
      connect(nodeId)
    },
    'node-restart-local': () => helper.restartLocalNode(),
    'node-tunnel-open': async (raw) => ({ port: await helper.tunnels.open(nodeTunnelRequestSchema.parse(raw)) }),
    'node-tunnel-close': (raw) => {
      // Best-effort cleanup (a task archived, a pane disposed), so an unparseable payload is ignored
      // rather than thrown back at a renderer that is already tearing down.
      if (!raw || typeof raw !== 'object') return
      const { nodeId, taskId } = raw as { nodeId?: unknown; taskId?: unknown }
      helper.tunnels.closeFor({
        ...(typeof nodeId === 'string' ? { nodeId } : {}),
        ...(typeof taskId === 'string' ? { taskId } : {}),
      })
    },
    'plugins-state': (): PluginsState => ({
      // Projected rather than passed through: `nodeIds` and the eviction timestamps are the helper's
      // bookkeeping, and a field added to the cache entry must not reach the renderer by default.
      cached: Object.fromEntries(
        Object.entries(helper.pluginCache.list()).map(([hash, entry]) => [hash, { pluginId: entry.pluginId, version: entry.version, bytes: entry.bytes }]),
      ),
      acks: helper.pluginTrust.list(),
      devGrants: helper.pluginTrust.listDevGrants(),
    }),
    'plugins-cache-put': async (raw) => {
      const { nodeId, pluginId, hash, version } = putSchema.parse(raw)
      const result = await helper.pluginCache.putFromNode(nodeId, pluginId, { hash, version })
      if ('hash' in result) helper.pluginTrust.recordDevAccept({ pluginId, nodeId, hash: result.hash, version })
      return result
    },
    'plugins-dev-grant': (raw): void => {
      const { pluginId, nodeId, path, grant } = devGrantSchema.parse(raw)
      if (!grant) return helper.pluginTrust.revokeDev(pluginId, nodeId)
      helper.pluginTrust.grantDev({ pluginId, nodeId, ...(path ? { path } : {}), grantedAt: Date.now() })
    },
    'plugins-trust-record': (raw): void => {
      const decision = decisionSchema.parse(raw)
      if (!helper.pluginCache.has(decision.hash)) throw new Error(`No cached bundle for ${decision.pluginId}@${decision.hash.slice(0, 12)}`)
      const disclosure = disclosureSchema.safeParse(raw)
      if (disclosure.success) return helper.pluginTrust.record({ ...decision, ...disclosure.data, decidedAt: Date.now() })
      console.warn(
        `[plugins] the disclosure recorded with ${decision.decision} for ${decision.pluginId} could not be parsed; storing a partial record:`,
        disclosure.error.message,
      )
      helper.pluginTrust.record({ ...decision, ...NO_DISCLOSURE, partial: true, decidedAt: Date.now() })
    },
  }

  const serve = async (socket: WebSocket, raw: unknown): Promise<void> => {
    const request = raw as HelperRequest
    // No id, nothing to answer, so this is the only case that goes unanswered.
    if (!request || typeof request.id !== 'number') return
    const reply = (message: object): void => socket.send(JSON.stringify({ id: request.id, ...message }))
    // `hasOwn`, not `in`: `method` came off the wire, and `in` would happily resolve `toString` off
    // the prototype and call it with whatever params came with it.
    if (!Object.hasOwn(handlers, request.method)) {
      // Answered rather than dropped. A caller left waiting on a method this build does not have sees
      // a spinner that never stops, which reads as a hung app instead of an old shell.
      return reply({ ok: false, error: `The desktop helper does not know '${String(request.method)}'.` })
    }
    try {
      reply({ ok: true, value: (await handlers[request.method](request.params)) ?? null })
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const http = createServer((_request, response) => response.writeHead(426).end())
  const wss = new WebSocketServer({ noServer: true })

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const origin = request.headers.origin
    if (url.pathname !== HELPER_PATH || !secretMatches(secret, url.searchParams.get('secret')) || (origin && origin !== appOrigin)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws)
      ws.on('close', () => sockets.delete(ws))
      ws.on('message', (data) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(String(data))
        } catch {
          return
        }
        void serve(ws, parsed)
      })
    })
  })

  // Every node remembered from a previous launch, brought up before the listener opens, so the
  // renderer's first fleet list is answered from a warm broker. The local node is adopted separately,
  // from the service start handoff, because its endpoint is only known once it has bound a port.
  for (const node of helper.fleet.list()) if (!node.local) connect(node.nodeId)

  return new Promise<HelperServer>((resolve, reject) => {
    http.once('error', reject)
    // Loopback only, and an ephemeral port: nothing off this machine can reach the broker, and no
    // fixed port exists for a second process to squat on before us.
    http.listen(0, '127.0.0.1', () => {
      const address = http.address()
      if (typeof address === 'string' || !address) return reject(new Error('The helper listener did not bind a port.'))
      resolve({
        port: address.port,
        secret,
        push,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.close()
            wss.close()
            ;(http as Server).close(() => done())
          }),
      })
    })
  })
}
