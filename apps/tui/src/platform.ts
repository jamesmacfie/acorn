import { NodeBroker } from '@acorn/custody/broker/nodeBroker.ts'
import { toNodeRecord } from '@acorn/custody/broker/fleetStore.ts'
import { probeNode, pairWithNode } from '@acorn/custody/broker/nodePairing.ts'
import type { NodePairRequest, NodeProbeResult, NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import type { OpenedNode } from './node/open'
import { startNode } from './node/supervise'
import { dataRootDir } from './node/paths'
import { createPluginCustody } from './plugins/custody'
import { setTerminalBadge, showInTerminal } from './kit/notify'
import { createLogger } from '@acorn/client-core/infra/telemetry/logger.ts'

const log = createLogger('fleet')

// The platform seam, from a Node process.
//
// The seam reads `window.acorn` and nothing else may name that global
// (tools/arch/boundaries.test.ts, the platform-seam rule). It guards on `typeof window`, so a Node
// host qualifies by defining one — and defines it as an object holding `acorn` and nothing else,
// rather than aliasing `globalThis`. A `window` that answers every question is worse than none:
// libraries probe it for `addEventListener` and `localStorage` and would find the process's own
// globals under a browser's name.
//
// The broker runs in this process, which the desktop's does not (docs/security.md § Trust
// boundaries). That is the trade 06-isolation.md records: the token lives in this module and reaches
// no kit component, a module boundary where the desktop has a process boundary. Everything below
// hands out a `NodeRecord`, which `toNodeRecord` strips of the certificate and the device row, and no
// token crosses into anything the renderer can read.

export type Platform = { broker: NodeBroker; dispose(): Promise<void> }

export function installPlatform(opened: OpenedNode, quit: () => void): Platform {
  const { fleet } = opened
  let supervised = opened.supervised
  let stop = opened.stop

  const frameHandlers: ((nodeId: string, frame: unknown) => void)[] = []
  const byteHandlers: ((nodeId: string, frame: Uint8Array) => void)[] = []
  const statusHandlers: ((status: NodeStatus) => void)[] = []
  const statuses = new Map<string, NodeStatus>()

  const broker = new NodeBroker({
    frame: (nodeId, frame) => { for (const handler of frameHandlers) handler(nodeId, frame) },
    // Terminal output, as the one binary frame (@acorn/protocol/ws.ts § The one binary frame). The
    // desktop tags the node id around this because it has a process boundary to cross; here the
    // broker is in this process, so the frame the node sent is handed over as it stands.
    bytes: (nodeId, frame) => { for (const handler of byteHandlers) handler(nodeId, frame) },
    status: (status) => {
      statuses.set(status.nodeId, status)
      for (const handler of statusHandlers) handler(status)
    },
  })

  // Same three lines as the desktop helper's `connect` (apps/desktop/src/helper/helperServer.ts): the
  // record the renderer sees, plus the two things it never does.
  const connect = (nodeId: string): void => {
    const node = fleet.get(nodeId)
    const token = node && fleet.tokenFor(nodeId)
    if (!node || !token) return
    broker.upsert({ ...toNodeRecord(node), token, ...(node.certPem ? { certPem: node.certPem } : {}) })
  }
  connect(opened.nodeId)
  // …and again when a node this run started announces itself. The row the line above used is the one
  // last time's handshake wrote, so its endpoint names a port nothing is listening on yet — the broker
  // reports `offline` and retries, which is the state the footer already draws. Connecting to the old
  // row rather than waiting is deliberate: a broker with no record at all answers every request with
  // "Unknown node", which is a hard error rather than a node that is not there yet, and the queries
  // the shell fires while the child boots would fail as bugs instead of as reconnects.
  if (opened.starting) void opened.starting.then((handshake) => connect(handshake.nodeId), () => {})

  const subscribe = <T,>(list: T[], handler: T): (() => void) => {
    list.push(handler)
    return () => {
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  // The probe is remembered here rather than handed back to the renderer, which is what makes
  // confirming the fingerprint a step instead of a parameter a caller could skip. The desktop helper
  // keeps it in the same place for the same reason.
  let pending: Awaited<ReturnType<typeof probeNode>> | null = null
  let announced = false

  const acorn = {
    platform: process.platform,
    nodeFetch: (nodeId: string, request: Parameters<NodeBroker['fetch']>[1]) => broker.fetch(nodeId, request),
    nodeAbort: (requestId: string) => broker.abort(requestId),
    nodeSend: (nodeId: string, frame: Parameters<NodeBroker['send']>[1]) => broker.send(nodeId, frame),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => subscribe(frameHandlers, cb),
    onNodeBytes: (cb: (nodeId: string, frame: Uint8Array) => void) => subscribe(byteHandlers, cb),
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      // Replay what the broker already reported: the socket opens during `connect` above, well before
      // anything renders, and a status the renderer never hears reads as `offline` forever.
      for (const status of statuses.values()) cb(status)
      return subscribe(statusHandlers, cb)
    },

    // `fleetList` is what picks the node: with no fleet bridge at all `selectActiveNode` reports ready
    // with nothing selected, and every request falls through to apiClient's same-origin path, which in
    // Node is a relative URL with no origin to be relative to.
    fleetList: async () => ({ nodes: fleet.list().map(toNodeRecord), statuses: [...statuses.values()] }),
    nodeProbe: async (endpoint: string): Promise<NodeProbeResult> => {
      const probe = await probeNode(endpoint)
      pending = probe
      const { certPem: _certPem, ...result } = probe
      return result
    },
    nodePair: async (request: NodePairRequest): Promise<NodeRecord> => {
      const probe = pending
      if (!probe) throw new Error('Confirm the node fingerprint before pairing.')
      if (!probe.compatible) throw new Error('That node speaks a different protocol version.')
      const result = await pairWithNode(probe, { code: request.code, deviceName: request.deviceName })
      pending = null
      const node = fleet.remember(
        { nodeId: result.nodeId, label: request.label, endpoint: probe.endpoint, fingerprint: probe.fingerprint, certPem: probe.certPem, deviceId: result.device.id, local: false },
        result.deviceToken,
      )
      connect(node.nodeId)
      return toNodeRecord(node)
    },
    nodeRename: async (nodeId: string, label: string): Promise<NodeRecord | null> => {
      const node = fleet.rename(nodeId, label)
      if (!node) return null
      connect(nodeId) // the label rides in the broker's record too
      return toNodeRecord(node)
    },
    nodeForget: async (nodeId: string, revoke: boolean): Promise<void> => {
      const node = fleet.get(nodeId)
      if (!node) return
      if (node.local) throw new Error("The node for this machine's data root cannot be removed.")
      if (revoke && node.deviceId) {
        // The last request that will ever authenticate, and it closes our own socket. A failure must
        // not abort the local forget: the usual reason revoke fails is that the node is offline.
        await broker
          .fetch(nodeId, { requestId: `forget-${nodeId}`, path: `/v2/core/devices/${node.deviceId}`, method: 'DELETE', headers: {} })
          .catch((error: unknown) => log.warn(`could not revoke this device on ${nodeId}`, error, { 'node.id': nodeId }))
      }
      broker.remove(nodeId)
      fleet.forget(nodeId)
    },
    nodeReconnect: (nodeId: string) => connect(nodeId),
    nodeRestartLocal: async (): Promise<void> => {
      if (!supervised) throw new Error('acorn attached to this node rather than starting it, so it is not ours to restart.')
      await stop()
      // A restarted node binds a fresh port and may mint a fresh token, so the fleet row is rewritten
      // from the new handshake rather than reused. What is not here is the desktop's `onNodeReplaced`
      // push: nothing in this build is holding a view of the old endpoint to invalidate. Phase 4 draws
      // the chrome that would need telling.
      // Awaited here, unlike the start at boot: nothing is waiting on a frame, and the caller asked
      // for a node it can use. The restarted child's stderr is piped and dropped rather than held —
      // the hold in `main.tsx` belongs to the child this process spawned at boot.
      const restarted = startNode(dataRootDir(), fleet.tokenFor(opened.nodeId))
      const handshake = await restarted.handshake
      stop = restarted.stop
      supervised = true
      fleet.remember(
        {
          nodeId: handshake.nodeId,
          label: fleet.get(handshake.nodeId)?.label ?? 'This computer',
          endpoint: handshake.endpoint,
          local: true,
          ...(handshake.fingerprint ? { fingerprint: handshake.fingerprint } : {}),
          ...(handshake.certPem ? { certPem: handshake.certPem } : {}),
        },
        handshake.deviceToken,
      )
      connect(handshake.nodeId)
    },

    // Telling somebody something happened while they were not looking, which in a terminal is the
    // terminal's job: an escape sequence goes to the emulator and the emulator raises the banner, in
    // the right app with the right icon (./kit/notify.ts).
    //
    // `onActivate` never fires. A terminal has no way to tell us its banner was clicked, so the
    // unsubscribe is all this can honestly return, and the inbox overlay is how a reader gets from
    // the notification to the thing that raised it (./chrome/Inbox.tsx).
    notify: {
      show: async (request: { title: string; body?: string }) => showInTerminal(request.title, request.body),
      onActivate: () => () => {},
      setBadge: setTerminalBadge,
    },

    // Custody of third-party plugin bundles: a content-addressed file cache and an acknowledgement
    // file under the TUI's config directory, hashed here rather than by a helper because there is no
    // helper (./plugins/custody.ts). The broker is the fetcher, which is why this is built after it.
    plugins: createPluginCustody(broker),

    // A terminal has no file manager to reveal a path in, so "open the data folder" is the path
    // itself. It prints on the way out rather than now, because the renderer owns the screen until
    // then and a line written under it would be drawn over before anyone read it.
    recovery: {
      openDataFolder: () => {
        if (announced) return
        announced = true
        process.once('exit', () => console.log(`acorn's data root is ${dataRootDir()}`))
      },
      quit,
    },
  }

  ;(globalThis as { window?: unknown }).window = { acorn }

  return {
    broker,
    dispose: async () => {
      broker.dispose()
      // Only a node this TUI started. One that was already running belongs to whoever started it, and
      // a second `acorn` quitting must not take it down under the first one.
      if (supervised) await stop()
    },
  }
}
