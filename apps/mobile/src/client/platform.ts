import { createSignal } from 'solid-js'
import { bodyForFetch } from '@acorn/client-core/infra/node/fetchBody.ts'
import type {
  NodeFetchRequest,
  NodeFetchResponse,
  NodeRecord,
  NodeStatus,
  NodeTransportError,
} from '@acorn/protocol/broker.ts'
import type { WsClientFrame, WsSendOptions } from '@acorn/protocol/ws.ts'

// The platform seam, from a phone's browser, through the gateway (docs/security/mobile-gateway.md).
//
// Two groups: `transport` and `fleet`. Requests go to `/node` plus the Node path, and events come
// over one `/events` socket. The gateway holds the device token and the pinned connection. This page
// holds a session cookie it can't read, so nothing here is a credential. Every other group is absent,
// and client-core hides what needs one: no pairing screen, no loaded plugins, and the page's own
// notifications and file inputs.
//
// It imports nothing that reads the seam, because `main.tsx` installs it before the app loads.

// The gateway's close code for a revoked session, `SIGNED_OUT_CLOSE_CODE` there. Not imported,
// because the gateway's module is Node code.
export const SIGNED_OUT_CLOSE_CODE = 4401
const FIRST_RETRY_MS = 250
const LAST_RETRY_MS = 5_000
const LEAVE_FLEET_ALONE = 'Pair and manage Nodes from Acorn on your computer.'

type GatewayMessage = { status: NodeStatus } | { frame: unknown } | { error: NodeTransportError }

// True once the gateway says this phone has no session. The shell shows the sign-in screen.
const [signedOut, setSignedOut] = createSignal(false)
export { signedOut }

export function installPlatform(): void {
  const frameHandlers = new Set<(nodeId: string, frame: unknown) => void>()
  const byteHandlers = new Set<(nodeId: string, frame: Uint8Array) => void>()
  const statusHandlers = new Set<(status: NodeStatus) => void>()
  const errorHandlers = new Set<(nodeId: string, error: NodeTransportError) => void>()
  const requests = new Map<string, AbortController>()
  // Frames sent while the socket is down. The desktop's helper holds the same queue, and the first
  // subscriptions go out before the socket has opened.
  const queued: string[] = []
  let socket: WebSocket | undefined
  let retryMs = FIRST_RETRY_MS
  let retry: ReturnType<typeof setTimeout> | undefined
  // The gateway serves one Node. Its ID arrives with the first status, or from `GET /session`.
  let nodeId = ''
  let latest: NodeStatus | undefined

  const subscribe = <T>(handlers: Set<T>, handler: T): (() => void) => {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }
  const report = (status: NodeStatus): void => {
    nodeId = status.nodeId
    latest = status
    for (const handler of statusHandlers) handler(status)
  }
  const signOut = (): void => {
    clearTimeout(retry)
    socket?.close()
    setSignedOut(true)
  }

  const receive = (event: MessageEvent): void => {
    if (event.data instanceof ArrayBuffer) {
      for (const handler of byteHandlers) handler(nodeId, new Uint8Array(event.data))
      return
    }
    let message: GatewayMessage
    try {
      message = JSON.parse(String(event.data)) as GatewayMessage
    } catch {
      return
    }
    if ('status' in message) report(message.status)
    else if ('frame' in message) for (const handler of frameHandlers) handler(nodeId, message.frame)
    else if ('error' in message) for (const handler of errorHandlers) handler(nodeId, message.error)
  }

  const connect = (): void => {
    clearTimeout(retry)
    if (socket || signedOut()) return
    const opened = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`)
    opened.binaryType = 'arraybuffer'
    opened.onopen = () => {
      retryMs = FIRST_RETRY_MS
      for (const message of queued.splice(0)) opened.send(message)
    }
    opened.onmessage = receive
    opened.onclose = (event) => {
      socket = undefined
      // The phone can't reach its Node while the gateway is down, whatever the Node's own state.
      if (latest && latest.state !== 'offline')
        report({ nodeId: latest.nodeId, state: 'offline', error: { code: 'unreachable' }, lastSeenAt: Date.now() })
      if (event.code === SIGNED_OUT_CLOSE_CODE) return signOut()
      // A refused upgrade closes the same way a stopped gateway does, so ask which it was.
      void fetch('/session', { cache: 'no-store' }).then(
        (answer) => (answer.status === 401 ? signOut() : schedule()),
        schedule,
      )
    }
    socket = opened
  }
  const schedule = (): void => {
    retry = setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, LAST_RETRY_MS)
  }

  // A suspended page can hold a dead socket that never said so, and a live one may have missed events
  // while it slept. Back in the foreground, the socket is replaced at once instead of waiting out the
  // backoff. The new socket's first status makes the client re-attach and refetch
  // (client-core/infra/node/wsClient.ts), and the Node shows offline only if this attempt fails too.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = undefined
    }
    retryMs = FIRST_RETRY_MS
    connect()
  })

  const acorn = {
    nodeFetch: async (_nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse> => {
      const controller = new AbortController()
      requests.set(request.requestId, controller)
      try {
        const answer = await fetch(`/node${request.path}`, {
          method: request.method ?? 'GET',
          headers: request.headers ?? {},
          body: bodyForFetch(request.body),
          signal: controller.signal,
        })
        const body = new Uint8Array(await answer.arrayBuffer())
        if (answer.status === 401 && errorCode(body) === 'signed_out') signOut()
        return { status: answer.status, headers: Object.fromEntries(answer.headers), body }
      } finally {
        requests.delete(request.requestId)
      }
    },
    nodeAbort: (requestId: string) => requests.get(requestId)?.abort(),
    nodeSend: (_nodeId: string, frame: WsClientFrame, options?: WsSendOptions) => {
      const message = JSON.stringify({ frame, ...options })
      if (socket?.readyState === WebSocket.OPEN) socket.send(message)
      else queued.push(message)
    },
    // The gateway serves one Node, so there is no other Node's events to turn away.
    nodeInterest: () => {},
    onNodeTransportError: (cb: (nodeId: string, error: NodeTransportError) => void) => subscribe(errorHandlers, cb),
    onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => subscribe(frameHandlers, cb),
    onNodeBytes: (cb: (nodeId: string, frame: Uint8Array) => void) => subscribe(byteHandlers, cb),
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      // A status the client never hears reads as `offline` until the next one.
      if (latest) cb(latest)
      return subscribe(statusHandlers, cb)
    },

    // Read from the gateway rather than from the socket, so a signed-out phone and a stopped gateway
    // fail differently and the list doesn't wait for the socket.
    fleetList: async (): Promise<{ nodes: NodeRecord[]; statuses: NodeStatus[] }> => {
      const answer = await fetch('/session', { cache: 'no-store' })
      if (answer.status === 401) signOut()
      if (!answer.ok) throw new Error(`The gateway answered ${answer.status}.`)
      const served = (await answer.json()) as { nodeId: string; label: string }
      nodeId = served.nodeId
      return {
        nodes: [{ nodeId: served.nodeId, label: served.label, endpoint: location.origin, local: false }],
        statuses: latest ? [latest] : [],
      }
    },
    nodeAdopt: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeRename: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeForget: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeRestartLocal: () => Promise.reject(new Error(LEAVE_FLEET_ALONE)),
    nodeReconnect: () => {
      retryMs = FIRST_RETRY_MS
      connect()
    },
  }
  // The seam reads this global and nothing else may name it (tools/arch/boundaries.test.ts).
  ;(globalThis as { acorn?: unknown }).acorn = acorn
  connect()
}

function errorCode(body: Uint8Array): string | undefined {
  try {
    return (JSON.parse(new TextDecoder().decode(body)) as { error?: { code?: string } }).error?.code
  } catch {
    return undefined
  }
}
