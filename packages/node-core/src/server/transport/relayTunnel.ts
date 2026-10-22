import type { Server } from 'node:https'
import { createWebSocketStream, WebSocket } from 'ws'
import {
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_PING_INTERVAL_MS,
  RELAY_REPLACED,
  RELAY_TLS_STREAM,
  relayControlMessageSchema,
  relayUrls,
} from '@acorn/protocol/relay.ts'
import type { RelaySettings } from './relaySettings'
import { createLogger } from '../telemetry/logger'

const log = createLogger('relay')

// The broker's reconnect schedule (apps/relay/PROTOCOL.md § Keep connections alive).
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
const JITTER = 0.2
// Control messages are a few dozen bytes.
const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024

export type RelayTunnel = { close(): void }

// The Node's outbound connection to its relay (docs/relay.md). Each stream the relay offers becomes
// one more connection to this Node's HTTPS server, entered by `emit('connection')`, so TLS, the Host
// guard, auth, and the WebSocket upgrade run on it unchanged. A relayed socket has no peer address,
// so a route that trusts loopback callers treats it as remote.
export function startRelayTunnel(server: Server, settings: RelaySettings, route: string): RelayTunnel {
  const headers = { authorization: `Bearer ${settings.credential}` }
  let control: WebSocket | null = null
  let reconnect: NodeJS.Timeout | null = null
  let attempt = 0
  let closed = false
  // A relay that stays down fails the same way every 30 seconds. One line says so.
  let lastFailure = ''

  const offer = (ws: WebSocket, text: string): void => {
    const message = relayControlMessageSchema.safeParse(parseJson(text))
    if (!message.success || message.data.type !== 'stream') return
    const { id, kind } = message.data
    if (kind !== RELAY_TLS_STREAM) {
      ws.send(JSON.stringify({ type: 'refuse', id, reason: `This Node doesn't serve ${kind} streams.` }))
      return
    }
    const stream = new WebSocket(relayUrls.accept(settings.url, route, id), {
      headers,
      maxPayload: RELAY_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    })
    stream.on('error', (error) => log.debug(`relay stream ${id} failed: ${error.message}`))
    stream.once('open', () => server.emit('connection', createWebSocketStream(stream)))
  }

  const connect = (): void => {
    const ws = new WebSocket(relayUrls.node(settings.url, route), {
      headers,
      maxPayload: MAX_CONTROL_MESSAGE_BYTES,
      perMessageDeflate: false,
    })
    control = ws
    let ping: NodeJS.Timeout | undefined
    let answered = true
    ws.on('open', () => {
      attempt = 0
      lastFailure = ''
      log.info(`connected to relay ${settings.url} as ${route}`)
      // The relay pings too, but only this side's ping notices a relay that vanished without a close.
      ping = setInterval(() => {
        if (!answered) return ws.terminate()
        answered = false
        ws.ping()
      }, RELAY_PING_INTERVAL_MS)
      ping.unref()
    })
    ws.on('pong', () => (answered = true))
    ws.on('message', (data, isBinary) => {
      if (!isBinary) offer(ws, data.toString())
    })
    ws.on('error', (error) => {
      if (error.message !== lastFailure) log.warn(`relay ${settings.url}: ${error.message}`)
      lastFailure = error.message
    })
    ws.on('close', (code) => {
      clearInterval(ping)
      if (closed || control !== ws) return
      control = null
      if (code === RELAY_REPLACED) {
        log.error(
          `another Node took route ${route} at relay ${settings.url}. This Node stops dialing it until it restarts.`,
        )
        return
      }
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]! * (1 + (Math.random() * 2 - 1) * JITTER)
      attempt += 1
      reconnect = setTimeout(() => {
        reconnect = null
        connect()
      }, delay)
    })
  }

  connect()
  return {
    close() {
      closed = true
      if (reconnect) clearTimeout(reconnect)
      control?.terminate()
    },
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
