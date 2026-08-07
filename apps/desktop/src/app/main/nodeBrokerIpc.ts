import { ipcMain, type BrowserWindow } from 'electron'
import {
  nodeFetchRequestSchema,
  nodeForgetRequestSchema,
  nodePairRequestSchema,
  nodeProbeRequestSchema,
  nodeRenameRequestSchema,
  nodeTunnelRequestSchema,
  type NodeProbeResult,
  type NodeRecord,
  type NodeTunnelResult,
} from '@acorn/protocol/broker.ts'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'
import { toNodeRecord, type FleetStore } from './fleetStore'
import type { NodeBroker } from './nodeBroker'
import { pairWithNode, probeNode } from './nodePairing'
import type { PreviewTunnels } from './previewTunnel'

// The IPC projection of the broker and the fleet store. Deliberately thin: every decision lives in
// nodeBroker.ts / fleetStore.ts / nodePairing.ts, which are Electron-free and therefore testable, and
// this file only validates and forwards.
//
// Requests from the renderer are Zod-parsed here rather than trusted. The renderer is our own code,
// but it is also the only part of the system that renders third-party content, so treating its
// messages as a trust boundary costs one parse per call and removes a whole class of "what if a
// compromised renderer asked for…" reasoning. In particular `path` must start with '/', which is what
// stops a request being aimed at a host other than the node.

export const NODE_FETCH = 'acorn:node-fetch'
export const NODE_ABORT = 'acorn:node-abort'
export const NODE_SEND = 'acorn:node-send'
export const NODE_FRAME = 'acorn:node-frame'
export const NODE_STATUS = 'acorn:node-status'
export const FLEET_LIST = 'acorn:fleet-list'
export const NODE_PROBE = 'acorn:node-probe'
export const NODE_PAIR = 'acorn:node-pair'
export const NODE_RENAME = 'acorn:node-rename'
export const NODE_FORGET = 'acorn:node-forget'
export const NODE_RECONNECT = 'acorn:node-reconnect'
export const NODE_RESTART_LOCAL = 'acorn:node-restart-local'
export const NODE_TUNNEL_OPEN = 'acorn:node-tunnel-open'
export const NODE_TUNNEL_CLOSE = 'acorn:node-tunnel-close'

export type NodeBrokerIpcDeps = {
  // Stop and start the supervised local service. Supplied by main/bootstrap.ts, which owns the
  // ServiceHost and the crash-restart budget — this module must not learn how to spawn anything.
  //
  // Only the LOCAL node has one. A remote node is started by launchd, systemd or a shell on another
  // machine, and nothing this app can do restarts it; Settings → Plugins says "restart required" there
  // instead, which is honest rather than a button that would lie.
  restartLocalNode?: () => Promise<void>
  // The preview tunnel's loopback listeners (main/previewTunnel.ts). Absent in a build with no preview.
  tunnels?: PreviewTunnels
}

export function registerNodeBrokerIpc(broker: NodeBroker, fleet: FleetStore, deps: NodeBrokerIpcDeps = {}): () => void {
  // Bring a remembered node's connection up (or back up). Idempotent: `upsert` tears down any existing
  // connection first, so this doubles as the Reconnect button's implementation.
  const connect = (nodeId: string): void => {
    const node = fleet.get(nodeId)
    const token = node && fleet.tokenFor(nodeId)
    // No token means no keychain on this machine (deviceTokenStore.ts). The node stays listed so the
    // owner can see it and re-pair; it just has no connection, which reads as `offline`.
    if (!node || !token) return
    broker.upsert({ ...toNodeRecord(node), token, ...(node.certPem ? { certPem: node.certPem } : {}) })
  }

  ipcMain.handle(NODE_FETCH, async (_event, nodeId: unknown, raw: unknown) => {
    if (typeof nodeId !== 'string') throw new Error('nodeFetch: nodeId must be a string')
    const request = nodeFetchRequestSchema.parse(raw)
    return broker.fetch(nodeId, request)
  })

  ipcMain.on(NODE_ABORT, (_event, requestId: unknown) => {
    if (typeof requestId === 'string') broker.abort(requestId)
  })

  ipcMain.on(NODE_SEND, (_event, nodeId: unknown, raw: unknown) => {
    if (typeof nodeId !== 'string') return
    // Structural check only. The frame vocabulary lives in @acorn/protocol/ws.ts as TypeScript unions
    // rather than Zod schemas, and mirroring all eleven client frames here would be a second copy to
    // keep in step for no gain: the node validates its own inbound frames, and what main needs to
    // know is only that this is a channel-tagged object it can forward.
    if (!raw || typeof raw !== 'object' || typeof (raw as { channel?: unknown }).channel !== 'string') return
    broker.send(nodeId, raw as WsClientFrame)
  })

  // Membership from the fleet store, connection state from the broker. The store is the authority on
  // "which nodes do I know" — a node whose token could not be remembered has no broker connection but
  // must still be listed, or the owner would have no way to re-pair it.
  ipcMain.handle(FLEET_LIST, () => ({ nodes: fleet.list().map(toNodeRecord), statuses: broker.statuses() }))

  // The probe is remembered here, not returned to the renderer: the certificate stays in main, and
  // making `pair` refer to a completed probe is what forces the fingerprint confirmation to be a step
  // rather than a parameter the renderer could skip.
  let pending: Awaited<ReturnType<typeof probeNode>> | null = null

  ipcMain.handle(NODE_PROBE, async (_event, raw: unknown): Promise<NodeProbeResult> => {
    const { endpoint } = nodeProbeRequestSchema.parse(raw)
    const probe = await probeNode(endpoint)
    pending = probe
    const { certPem: _certPem, ...result } = probe
    return result
  })

  ipcMain.handle(NODE_PAIR, async (_event, raw: unknown): Promise<NodeRecord> => {
    const request = nodePairRequestSchema.parse(raw)
    const probe = pending
    if (!probe) throw new Error('Confirm the node fingerprint before pairing.')
    if (!probe.compatible) throw new Error('That node speaks a different protocol version.')
    const result = await pairWithNode(probe, { code: request.code, deviceName: request.deviceName })
    pending = null
    const node = fleet.remember(
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
  })

  ipcMain.handle(NODE_RENAME, (_event, raw: unknown): NodeRecord | null => {
    const { nodeId, label } = nodeRenameRequestSchema.parse(raw)
    const node = fleet.rename(nodeId, label)
    if (!node) return null
    // The label rides in the broker's record too (it is part of NodeRecord), so keep the live
    // connection's copy in step rather than waiting for the next launch.
    connect(nodeId)
    return toNodeRecord(node)
  })

  ipcMain.handle(NODE_FORGET, async (_event, raw: unknown): Promise<void> => {
    const { nodeId, revoke } = nodeForgetRequestSchema.parse(raw)
    const node = fleet.get(nodeId)
    if (!node) return
    // The local node is this app's own data root, not a pairing (docs/vNext/architecture.md § Fleet
    // semantics: "Exactly one, and it cannot be unpaired").
    if (node.local) throw new Error('The local node cannot be removed.')
    if (revoke && node.deviceId) {
      // Ask the node to forget this client, through the broker — this is the last request that will ever
      // authenticate, and it closes our own socket. A failure here must NOT abort the local forget: the
      // owner asked to stop using this node, and the usual reason revoke fails is that it is offline.
      await broker
        .fetch(nodeId, { requestId: `forget-${nodeId}`, path: `/v2/core/devices/${node.deviceId}`, method: 'DELETE', headers: {} })
        .catch((error: unknown) => console.warn(`[fleet] could not revoke this device on ${nodeId}:`, error))
    }
    broker.remove(nodeId)
    fleet.forget(nodeId)
    // A pipe to a node we have just stopped trusting must not outlive the pairing.
    deps.tunnels?.closeFor({ nodeId })
  })

  ipcMain.on(NODE_RECONNECT, (_event, nodeId: unknown) => {
    if (typeof nodeId === 'string') connect(nodeId)
  })

  // Settings → Plugins' Restart button. A plugin's routes, tables and jobs are wired at init, so nothing
  // short of a restart applies a toggle (plugins.md: "disabling unregisters contributions at next
  // startup"). The list itself lives in the node's data root, so this needs no argument — the node
  // re-reads it on the way up.
  ipcMain.handle(NODE_RESTART_LOCAL, async (): Promise<void> => {
    if (!deps.restartLocalNode) throw new Error('This build does not supervise a local node.')
    await deps.restartLocalNode()
  })

  // The preview tunnel. The renderer sends a task and a port ON THE NODE and gets back a port on THIS
  // machine; it never learns the endpoint or the token, and the pipe is main's (main/previewTunnel.ts).
  ipcMain.handle(NODE_TUNNEL_OPEN, async (_event, raw: unknown): Promise<NodeTunnelResult> => {
    const request = nodeTunnelRequestSchema.parse(raw)
    if (!deps.tunnels) throw new Error('This build cannot open a preview tunnel.')
    return { port: await deps.tunnels.open(request) }
  })

  ipcMain.on(NODE_TUNNEL_CLOSE, (_event, raw: unknown) => {
    // Closing is a best-effort cleanup (a task archived, a pane disposed), so an unparseable payload is
    // ignored rather than thrown back at a renderer that is already tearing down.
    if (!raw || typeof raw !== 'object') return
    const { nodeId, taskId } = raw as { nodeId?: unknown; taskId?: unknown }
    deps.tunnels?.closeFor({
      ...(typeof nodeId === 'string' ? { nodeId } : {}),
      ...(typeof taskId === 'string' ? { taskId } : {}),
    })
  })

  // Bring up every node remembered from a previous launch. The local one is adopted separately, from
  // the service start handoff, because its endpoint is only known once it has bound a port.
  for (const node of fleet.list()) if (!node.local) connect(node.nodeId)

  return () => {
    for (const channel of [NODE_FETCH, FLEET_LIST, NODE_PROBE, NODE_PAIR, NODE_RENAME, NODE_FORGET, NODE_RESTART_LOCAL, NODE_TUNNEL_OPEN]) {
      ipcMain.removeHandler(channel)
    }
    ipcMain.removeAllListeners(NODE_ABORT)
    ipcMain.removeAllListeners(NODE_SEND)
    ipcMain.removeAllListeners(NODE_RECONNECT)
    ipcMain.removeAllListeners(NODE_TUNNEL_CLOSE)
  }
}

// Push channels. Held as a function of the window rather than a captured reference so a window
// replaced by crash recovery gets the new one, and a destroyed window is simply skipped.
export function brokerPushTargets(window: () => BrowserWindow | null) {
  const send = (channel: string, ...args: unknown[]): void => {
    const win = window()
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }
  return {
    frame: (nodeId: string, frame: unknown) => send(NODE_FRAME, nodeId, frame),
    status: (status: unknown) => send(NODE_STATUS, status),
  }
}
