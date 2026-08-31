import { NodeBroker, type BrokerNode } from '@acorn/custody/broker/nodeBroker.ts'
import type { NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'

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
// no kit component, a module boundary where the desktop has a process boundary.

export type Handshake = {
  nodeId: string
  endpoint: string
  fingerprint?: string
  certPem?: string
  deviceToken: string
}

/** The node's own boot line, as `apps/node/src/entries/standalone.ts` prints it. Phase 0 is handed
 *  one rather than finding it: attach-or-start, the data-root lock and pairing are phase 3. */
export function readHandshake(raw: string): Handshake {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('The handshake is not an object.')
  const value = parsed as Partial<Handshake>
  if (!value.nodeId || !value.endpoint || !value.deviceToken) {
    throw new Error('The handshake needs nodeId, endpoint and deviceToken. Copy the first line the node printed.')
  }
  return value as Handshake
}

export function installPlatform(handshake: Handshake): { broker: NodeBroker; record: NodeRecord } {
  const record: NodeRecord = {
    nodeId: handshake.nodeId,
    label: 'local',
    endpoint: handshake.endpoint,
    ...(handshake.fingerprint ? { fingerprint: handshake.fingerprint } : {}),
    local: true,
  }
  const node: BrokerNode = {
    ...record,
    token: handshake.deviceToken,
    ...(handshake.certPem ? { certPem: handshake.certPem } : {}),
  }

  const frameHandlers: ((nodeId: string, frame: unknown) => void)[] = []
  const statusHandlers: ((status: NodeStatus) => void)[] = []
  const statuses = new Map<string, NodeStatus>()

  const broker = new NodeBroker({
    frame: (nodeId, frame) => { for (const handler of frameHandlers) handler(nodeId, frame) },
    status: (status) => {
      statuses.set(status.nodeId, status)
      for (const handler of statusHandlers) handler(status)
    },
  })
  broker.upsert(node)

  const subscribe = <T,>(list: T[], handler: T): (() => void) => {
    list.push(handler)
    return () => {
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  // `fleetList` is here even though phase 0 pairs with nothing, because it is what picks the node:
  // with no fleet bridge at all `selectActiveNode` reports ready with no node selected, and every
  // request falls through to apiClient's same-origin path, which in Node is a relative URL with no
  // origin to be relative to. The rest of the group is absent, which the seam supports as a product
  // state — this build cannot pair, and says so.
  const acorn = {
    platform: process.platform,
    nodeFetch: (nodeId: string, request: Parameters<NodeBroker['fetch']>[1]) => broker.fetch(nodeId, request),
    nodeAbort: (requestId: string) => broker.abort(requestId),
    nodeSend: (nodeId: string, frame: Parameters<NodeBroker['send']>[1]) => broker.send(nodeId, frame),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => subscribe(frameHandlers, cb),
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      // Replay what the broker already reported: the socket opens during `upsert` above, well before
      // anything renders, and a status the renderer never hears reads as `offline` forever.
      for (const status of statuses.values()) cb(status)
      return subscribe(statusHandlers, cb)
    },
    fleetList: async () => ({ nodes: [record], statuses: [...statuses.values()] }),
  }

  ;(globalThis as { window?: unknown }).window = { acorn }
  return { broker, record }
}
