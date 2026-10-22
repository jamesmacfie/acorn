import { Agent as HttpsAgent, type AgentOptions } from 'node:https'
import type { ClientRequestArgs } from 'node:http'
import type { Duplex } from 'node:stream'
import { createWebSocketStream, WebSocket } from 'ws'
import type { RelayTicketFor } from './relayTickets'
import {
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_TLS_STREAM,
  relayHost,
  relayRouteIdSchema,
  relayUrls,
  type RelayRoute,
} from '@acorn/protocol/relay.ts'

// The broker's socket factory for a Node reached through a relay (docs/relay.md). Every connection to
// such a Node is one relay stream, and TLS runs inside it, here, end to end with the Node. So the
// relay carries only ciphertext, and the pin is checked exactly as it is on a direct connection.

export type OpenRelayStream = (relay: RelayRoute, credential: string) => Promise<Duplex>

// A pinned HTTPS agent whose sockets are relay streams rather than TCP connections. Pooling, keep-alive,
// and TLS session reuse are the base agent's, unchanged: only where the bytes go differs.
export class RelayAgent extends HttpsAgent {
  readonly #open: () => Promise<Duplex>

  constructor(options: AgentOptions, open: () => Promise<Duplex>) {
    super(options)
    this.#open = open
  }

  // Asynchronous, through the callback, because a stream exists only once the relay has reached the
  // Node. The base method then runs the pinned TLS handshake over it.
  override createConnection(
    options: ClientRequestArgs,
    callback?: (error: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    this.#open().then(
      (socket) => callback?.(null, super.createConnection({ ...options, socket } as ClientRequestArgs)!),
      (error: Error) => callback?.(error, undefined as never),
    )
    return undefined
  }
}

// What a stream presents to the relay: the credential typed into the address, as in self-hosted mode,
// or else a ticket for the account.
export const relayCredentialFor = (
  credential: string | undefined,
  route: string,
  ticketFor: RelayTicketFor | undefined,
): Promise<string> =>
  credential !== undefined
    ? Promise.resolve(credential)
    : ticketFor
      ? ticketFor(route)
      : Promise.reject(new Error('This relay address has no credential, and nothing here can get a ticket for it.'))

// The relay answers the upgrade only once the Node has opened its end, so an open WebSocket is a stream
// ready to carry the TLS handshake (apps/relay/PROTOCOL.md § Open a stream).
export const openRelayStream: OpenRelayStream = (relay, credential) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrls.connect(relay.url, relay.route, RELAY_TLS_STREAM), {
      headers: { authorization: `Bearer ${credential}` },
      maxPayload: RELAY_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      handshakeTimeout: OPEN_TIMEOUT_MS,
    })
    ws.once('open', () => resolve(createWebSocketStream(ws)))
    ws.once('unexpected-response', (request, response) => {
      request.destroy()
      reject(new Error(refusals[response.statusCode ?? 0] ?? `The relay answered ${response.statusCode}.`))
    })
    ws.on('error', reject)
  })

// Longer than the relay's 10 seconds for the Node to answer, so the relay's 504 arrives first.
const OPEN_TIMEOUT_MS = 15_000

const refusals: Record<number, string> = {
  401: 'The relay refused the credential or ticket. Check the credential in the relay address, or sign in to the account that owns the Node.',
  404: "The Node isn't connected to its relay.",
  502: 'The Node refused the relay stream.',
  503: 'The Node has too many relay streams open.',
  504: "The Node didn't answer through its relay.",
}

// What a person types to add a Node: `https://host:port` for a direct one, or a relay route for one
// reached through a relay, `wss://<credential>@relay.example.com/<route>`. The credential comes off the
// address here and is kept apart from it from then on. A route with no credential,
// `wss://relay.example.com/<route>`, is reached with a ticket from the person's account.
export type NodeAddress = { endpoint: string; relay?: RelayRoute; relayCredential?: string }

export function parseNodeAddress(address: string): NodeAddress {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    // Not echoed: a mistyped relay address still carries its credential.
    throw new Error("That isn't an address. Use https://host:port, or wss://<credential>@relay/<node ID>.")
  }
  if (url.protocol === 'https:') return { endpoint: url.origin }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:')
    throw new Error('A Node address starts with https://, or with wss:// for a relay.')
  const path = url.pathname.split('/').filter(Boolean)
  const route = path.pop() ?? ''
  if (!relayRouteIdSchema.safeParse(route).success || url.search || url.hash || url.password)
    throw new Error('A relay address ends with the Node ID, as in wss://<credential>@relay.example.com/<node ID>.')
  const relayCredential = decodeURIComponent(url.username)
  return {
    endpoint: `https://${relayHost(route)}`,
    relay: { url: `${url.protocol}//${url.host}${path.map((segment) => `/${segment}`).join('')}`, route },
    ...(relayCredential ? { relayCredential } : {}),
  }
}
