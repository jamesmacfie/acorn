import type { ChannelClient, ChannelListeners, ChannelRequest, ChannelResponse } from '@acorn/channel/client.ts'
import { IdentityMismatchError } from '@acorn/channel/errors.ts'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { AccountError } from './accountError'

// One Node as the phone sees it: a channel that is opened when something needs it, replaced when it
// drops, and given up on for the three reasons retrying can't fix. It holds the Node's device token, so a
// request is sent with it and nothing outside this file ever reads it (docs/relay/phone-channel.md).
//
// It imports nothing that reads the platform seam, because `main.tsx` installs the seam before the app
// loads.

const FIRST_RETRY_MS = 250
const LAST_RETRY_MS = 5_000
// How long a request waits for the channel before it fails as offline.
const REQUEST_WAIT_MS = 10_000
// A channel nobody is listening to and nobody has asked anything of for this long is closed.
const IDLE_MS = 30_000

export type LinkHooks = {
  /** Opens a channel: a ticket, a relay stream, and the handshake against the pinned key. */
  open(listeners: ChannelListeners): Promise<ChannelClient>
  /** The device token for this Node, or null when it has none. */
  token(): Promise<string | null>
  report(status: NodeStatus): void
  frame(frame: unknown): void
  bytes(frame: Uint8Array): void
  /** The account service says the person's session ended. */
  signedOut(): void
}

export type NodeLink = {
  /** Opens the channel if it isn't open. Called by whatever needs the Node. */
  start(): void
  /** Whether this link carries the event feed, which only the Node on screen needs. */
  setEvents(wanted: boolean): void
  request(request: ChannelRequest, signal?: AbortSignal): Promise<ChannelResponse>
  /** A client frame for the event feed, as JSON text. Held until the feed is open. */
  sendFrame(json: string): void
  /** Try again now, instead of after the wait. */
  reconnectNow(): void
  /** Replace the channel with a new one, which a phone that was asleep can't trust the old one to be. */
  restart(): void
  stop(): void
}

type Waiter = { resolve(client: ChannelClient): void; reject(error: Error): void }

export class NodeOfflineError extends Error {
  readonly code = 'node_offline'
  constructor() {
    super('This Node is offline, so nothing was sent.')
    this.name = 'NodeOfflineError'
  }
}

export function createNodeLink(nodeId: string, hooks: LinkHooks): NodeLink {
  let client: ChannelClient | undefined
  let token: string | null | undefined
  // Each start and each stop begins a new generation, and a loop from an older one lets go.
  let generation = 0
  let running = false
  let halted: NodeStatus['error'] | undefined
  let wantsEvents = false
  let attached = false
  let seq = 0
  let retryMs = FIRST_RETRY_MS
  let wake: (() => void) | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  const queued: string[] = []
  const waiters = new Set<Waiter>()

  const report = (state: NodeStatus['state'], error?: NodeStatus['error']): void =>
    hooks.report({ nodeId, state, ...(error ? { error } : {}), lastSeenAt: Date.now() })

  const listeners: ChannelListeners = {
    onBytes: (frame) => {
      if (attached) hooks.bytes(frame)
    },
    onFrame: (json) => {
      if (!attached) return
      let frame: { channel?: unknown; seq?: unknown }
      try {
        frame = JSON.parse(json) as typeof frame
      } catch {
        return
      }
      // The Node numbers a connection's frames from one. A gap means some were lost, and there is no history
      // to replay, so the remedy is a new channel and a refetch. A `ws:shed` marker takes a number itself
      // and says the Node dropped some on purpose.
      if (typeof frame.seq === 'number') {
        if (seq !== 0 && frame.seq !== seq + 1 && frame.channel !== 'ws:shed') return client?.close()
        seq = frame.seq
      }
      hooks.frame(frame)
    },
  }

  // Waits until the channel is open, until the person's wait runs out, or until the link has given up.
  const online = (): Promise<ChannelClient> => {
    if (client) return Promise.resolve(client)
    if (halted) return Promise.reject(new NodeOfflineError())
    start()
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject }
      waiters.add(waiter)
      setTimeout(() => {
        if (waiters.delete(waiter)) reject(new NodeOfflineError())
      }, REQUEST_WAIT_MS)
    })
  }

  const giveUp = (error: NonNullable<NodeStatus['error']>): void => {
    halted = error
    running = false
    generation++
    client?.close()
    client = undefined
    attached = false
    // The Node's own word for it: the token isn't a live device's, as against not being able to reach it.
    report(error.code === 'unauthorized' ? 'revoked' : 'offline', error)
    for (const waiter of waiters) waiter.reject(new NodeOfflineError())
    waiters.clear()
  }

  async function attachEvents(open: ChannelClient): Promise<void> {
    if (!wantsEvents || attached || !token) return
    seq = 0
    if (!(await open.openEvents(token))) {
      if (client === open) giveUp({ code: 'unauthorized' })
      return
    }
    attached = true
    for (const json of queued.splice(0)) open.sendFrame(json)
  }

  async function run(mine: number): Promise<void> {
    token ??= await hooks.token()
    if (!token) return giveUp({ code: 'unauthorized' })
    while (generation === mine) {
      try {
        const open = await hooks.open(listeners)
        if (generation !== mine) return open.close()
        client = open
        await attachEvents(open)
        if (generation !== mine) return
        retryMs = FIRST_RETRY_MS
        report('online')
        for (const waiter of waiters) waiter.resolve(open)
        waiters.clear()
        await open.closed
      } catch (error) {
        if (generation !== mine) return
        // Retrying can't make a different Node the pinned one, can't sign the person back in, and can't
        // bring back a Node the account no longer lists.
        if (error instanceof IdentityMismatchError) return giveUp({ code: 'identity_mismatch' })
        if (error instanceof AccountError && error.signedOut) {
          hooks.signedOut()
          return giveUp({ code: 'unreachable' })
        }
        if (error instanceof AccountError && error.code === 'not_found') return giveUp({ code: 'unreachable' })
      }
      if (generation !== mine) return
      client = undefined
      attached = false
      report('offline', { code: 'unreachable' })
      await new Promise<void>((resolve) => {
        wake = resolve
        setTimeout(resolve, retryMs)
      })
      wake = undefined
      retryMs = Math.min(retryMs * 2, LAST_RETRY_MS)
    }
  }

  function start(): void {
    if (running || halted) return
    running = true
    void run(++generation)
  }

  // A link nobody uses closes its channel, so a Node the person looked at once isn't held open.
  const touch = (): void => {
    clearTimeout(idle)
    if (!wantsEvents) idle = setTimeout(stop, IDLE_MS)
  }

  function stop(): void {
    running = false
    generation++
    clearTimeout(idle)
    wake?.()
    client?.close()
    client = undefined
    attached = false
    for (const waiter of waiters) waiter.reject(new NodeOfflineError())
    waiters.clear()
  }

  return {
    start,
    setEvents(wanted) {
      wantsEvents = wanted
      if (wanted) {
        clearTimeout(idle)
        start()
        if (client) void attachEvents(client)
      } else touch()
    },
    async request(request, signal) {
      touch()
      const open = await online()
      const response = await open.request(
        { ...request, headers: { ...request.headers, authorization: `Bearer ${token}` } },
        signal,
      )
      // The Node's own router says the token isn't a live device's. The phone is signed out of this Node.
      if (response.status === 401) giveUp({ code: 'unauthorized' })
      return response
    },
    sendFrame(json) {
      if (client && attached) client.sendFrame(json)
      else queued.push(json)
    },
    reconnectNow() {
      if (halted) return
      retryMs = FIRST_RETRY_MS
      if (running) wake?.()
      else start()
    },
    restart() {
      if (!running) return
      stop()
      retryMs = FIRST_RETRY_MS
      start()
    },
    stop,
  }
}
