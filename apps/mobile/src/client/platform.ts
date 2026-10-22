import { createSignal } from 'solid-js'
import { bodyForFetch } from '@acorn/client-core/infra/node/fetchBody.ts'
import type {
  NodeFetchBody,
  NodeFetchRequest,
  NodeFetchResponse,
  NodeRecord,
  NodeStatus,
  NodeTransportError,
} from '@acorn/protocol/broker.ts'
import { relayHost } from '@acorn/protocol/relay.ts'
import type { WsClientFrame, WsSendOptions } from '@acorn/protocol/ws.ts'
import { createNodeLink, type NodeLink } from './nodeLink'
import { forgetPaired, pairedNodes, readToken, renamePaired, type PairedNode } from './pairedNodes'

// The platform seam, from a phone's browser, through the account and an encrypted channel
// (docs/relay/phone-channel.md).
//
// Two groups: `transport` and `fleet`. Each Node the phone is paired with gets a channel through the relay
// when something needs it, a device token only this module can read, and its own query cache in
// client-core. Events come over the channel of the Node on screen. Every other group is absent, and
// client-core hides what needs one: no loaded plugins, and the page's own notifications and file inputs.
//
// It imports nothing that reads the seam, because `main.tsx` installs it before the app loads.

const LEAVE_FLEET_ALONE = 'Pair a Node from the Nodes screen.'
const DEFAULT_TIMEOUT_MS = 30_000

// True once the account says this phone has no session. The shell shows the sign-in screen.
const [signedOut, setSignedOut] = createSignal(false)
export { signedOut, setSignedOut }

// Set when the pairing screen finishes, so the seam's fleet list is read again.
const [pairedVersion, setPairedVersion] = createSignal(0)
export { pairedVersion }

type Encoded = { bytes?: Uint8Array; contentType?: string }

// A form becomes the bytes a browser would have sent, so the channel carries one kind of body.
async function encodeBody(body: NodeFetchBody | undefined): Promise<Encoded> {
  const init = bodyForFetch(body)
  if (!init) return {}
  if (init instanceof Uint8Array) return { bytes: init }
  const response = new Response(init)
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  }
}

const toRecord = (node: PairedNode): NodeRecord => ({
  nodeId: node.nodeId,
  label: node.label,
  endpoint: `https://${relayHost(node.nodeId)}`,
  local: false,
})

export function installPlatform(): void {
  const frameHandlers = new Set<(nodeId: string, frame: unknown) => void>()
  const byteHandlers = new Set<(nodeId: string, frame: Uint8Array) => void>()
  const statusHandlers = new Set<(status: NodeStatus) => void>()
  const errorHandlers = new Set<(nodeId: string, error: NodeTransportError) => void>()
  const requests = new Map<string, AbortController>()
  const latest = new Map<string, NodeStatus>()
  const known = new Map<string, PairedNode>()
  const links = new Map<string, NodeLink>()
  let interest: string | null = null

  const subscribe = <T>(handlers: Set<T>, handler: T): (() => void) => {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  const refreshKnown = async (): Promise<PairedNode[]> => {
    const nodes = await pairedNodes()
    known.clear()
    for (const node of nodes) known.set(node.nodeId, node)
    // After a page load, client-core can name the Node on screen before this list has been read. The
    // feed waits for it, or the phone hears no events until the person picks another Node.
    if (interest && known.has(interest)) linkFor(interest).setEvents(true)
    return nodes
  }

  function linkFor(nodeId: string): NodeLink {
    const existing = links.get(nodeId)
    if (existing) return existing
    const node = known.get(nodeId)
    if (!node) throw new Error('This phone isn’t paired with that Node.')
    const link = createNodeLink(nodeId, {
      // Loaded with the first channel: the account's schemas and the ticket call aren't the first screen's.
      open: async (listeners) => (await import('./openChannel')).openNodeChannel(nodeId, node.channelKey, listeners),
      token: () => readToken(nodeId),
      report: (status) => {
        latest.set(nodeId, status)
        for (const handler of statusHandlers) handler(status)
      },
      frame: (frame) => {
        for (const handler of frameHandlers) handler(nodeId, frame)
      },
      bytes: (frame) => {
        for (const handler of byteHandlers) handler(nodeId, frame)
      },
      signedOut: () => setSignedOut(true),
    })
    links.set(nodeId, link)
    return link
  }

  // A suspended page can hold a dead channel that never said so, and a live one may have missed events
  // while it slept. Back in the foreground, the channel of the Node on screen is replaced at once instead
  // of waiting for the heartbeat. Its first status makes the client re-attach and refetch
  // (client-core/infra/node/wsClient.ts).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && interest) links.get(interest)?.restart()
  })

  const acorn = {
    nodeFetch: async (nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse> => {
      const controller = new AbortController()
      requests.set(request.requestId, controller)
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let timedOut = false
      const timer = setTimeout(() => ((timedOut = true), controller.abort()), timeoutMs)
      try {
        const { bytes, contentType } = await encodeBody(request.body)
        const headers = { ...request.headers }
        if (contentType && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type'))
          headers['content-type'] = contentType
        const answer = await linkFor(nodeId).request(
          { method: request.method ?? 'GET', path: request.path, headers, ...(bytes ? { body: bytes } : {}) },
          controller.signal,
        )
        // A view of an ArrayBuffer, which the channel's type doesn't say.
        return { ...answer, body: answer.body as Uint8Array<ArrayBuffer> }
      } catch (error) {
        if (timedOut)
          throw Object.assign(new Error(`The node did not answer within ${timeoutMs}ms`), { name: 'TimeoutError' })
        throw error
      } finally {
        clearTimeout(timer)
        requests.delete(request.requestId)
      }
    },
    nodeAbort: (requestId: string) => requests.get(requestId)?.abort(),
    nodeSend: (nodeId: string, frame: WsClientFrame, _options?: WsSendOptions) =>
      linkFor(nodeId).sendFrame(JSON.stringify(frame)),
    // Only the Node on screen holds the event feed, so another Node's events aren't carried at all.
    nodeInterest: (nodeId: string | null) => {
      if (nodeId === interest) return
      if (interest) links.get(interest)?.setEvents(false)
      interest = nodeId
      if (nodeId && known.has(nodeId)) linkFor(nodeId).setEvents(true)
    },
    onNodeTransportError: (cb: (nodeId: string, error: NodeTransportError) => void) => subscribe(errorHandlers, cb),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => subscribe(frameHandlers, cb),
    onNodeBytes: (cb: (nodeId: string, frame: Uint8Array) => void) => subscribe(byteHandlers, cb),
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      // A status the client never hears reads as `offline` until the next one.
      for (const status of latest.values()) cb(status)
      return subscribe(statusHandlers, cb)
    },

    fleetList: async (): Promise<{ nodes: NodeRecord[]; statuses: NodeStatus[] }> => {
      const nodes = await refreshKnown()
      return { nodes: nodes.map(toRecord), statuses: [...latest.values()] }
    },
    nodeAdopt: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeCollectAdoption: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeRename: async (nodeId: string, label: string): Promise<NodeRecord | null> => {
      await renamePaired(nodeId, label)
      await refreshKnown()
      const node = known.get(nodeId)
      return node ? toRecord(node) : null
    },
    // A phone can't revoke its own device on the Node, because it may not manage devices. It forgets the
    // Node, and the device stays on the Node's list until someone revokes it from a computer.
    nodeForget: async (nodeId: string, _revoke: boolean): Promise<void> => {
      links.get(nodeId)?.stop()
      links.delete(nodeId)
      latest.delete(nodeId)
      await forgetPaired(nodeId)
      await refreshKnown()
      setPairedVersion((version) => version + 1)
    },
    nodeRestartLocal: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeReconnect: (nodeId: string) => links.get(nodeId)?.reconnectNow(),
  }
  // The seam reads this global and nothing else may name it (tools/arch/boundaries.test.ts).
  ;(globalThis as { acorn?: unknown }).acorn = acorn
}
