import { z } from 'zod'

// The relay protocol's shared names and messages (docs/relay.md). apps/relay/PROTOCOL.md specifies the
// wire format, so someone can build a compatible relay without reading this package.

// A route names one Node at one relay. It becomes a URL path segment and a Host label, so it keeps to
// the characters both allow. A Node's ID, a lowercase UUID, is one.
export const relayRouteIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)

// Where a relayed Node is: its relay's URL and its route there. Stored on the fleet record beside the
// endpoint, which for a relayed Node is `https://<relayHost(route)>`.
export const relayRouteSchema = z.strictObject({
  url: z
    .string()
    .url()
    .refine((url) => /^wss?:$/.test(new URL(url).protocol), 'A relay URL starts with wss:// or ws://.'),
  route: relayRouteIdSchema,
})
export type RelayRoute = z.infer<typeof relayRouteSchema>

// A node's address as a person reads and types it: its relay route when it has one, without the
// credential the typed form carries, or else its endpoint.
export const nodeAddress = (node: { endpoint: string; relay?: RelayRoute }): string =>
  node.relay ? `${node.relay.url.replace(/\/+$/, '')}/${node.relay.route}` : node.endpoint

// Whether text a person typed is an address to pair with rather than the name of a known node.
export const isNodeAddress = (text: string): boolean => /^(https|wss?):\/\//.test(text)

// The Host a client sends through the relay. Made up, so no DNS answers for it, and a Node accepts it
// only while it has relay settings.
export const relayHost = (route: string): string => `${route}.relay.acorn`

// What the bytes of a stream are. `tls` is a native client's TLS connection to the Node's HTTPS server.
export const RELAY_TLS_STREAM = 'tls'
export const relayStreamKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
export const relayStreamIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

const base = (url: string): string => url.replace(/\/+$/, '')
export const relayUrls = {
  node: (url: string, route: string): string => `${base(url)}/v1/nodes/${route}`,
  accept: (url: string, route: string, stream: string): string => `${base(url)}/v1/nodes/${route}/streams/${stream}`,
  connect: (url: string, route: string, kind: string): string => `${base(url)}/v1/connect/${route}?kind=${kind}`,
}

// Messages on a Node's control connection. Objects stay open, because a peer ignores fields it doesn't
// know (apps/relay/PROTOCOL.md § Versioning).
export const relayControlMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stream'), id: relayStreamIdSchema, kind: relayStreamKindSchema }),
  z.object({ type: z.literal('refuse'), id: relayStreamIdSchema, reason: z.string().max(200) }),
])

export const RELAY_MAX_MESSAGE_BYTES = 1024 * 1024
export const RELAY_PING_INTERVAL_MS = 30_000
// The close code a relay sends a Node whose route another connection took.
export const RELAY_REPLACED = 4000
// The close code a relay sends a Node whose relay credential the account service revoked.
export const RELAY_REVOKED = 4001
