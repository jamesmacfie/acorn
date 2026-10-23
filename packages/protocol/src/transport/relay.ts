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
// A phone browser's encrypted channel (docs/relay/phone-channel.md).
export const RELAY_BROWSER_STREAM = 'browser'
// A browser's TLS connection to one of the Node's preview names, which the Node ends
// (apps/relay/PROTOCOL.md § Preview streams).
export const RELAY_PREVIEW_STREAM = 'preview'
export const relayStreamKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
export const relayStreamIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

// A browser can't set `Authorization` on a WebSocket upgrade, but it can offer subprotocols. It offers
// the relay's own name, which the relay selects, and its ticket behind a prefix, which the relay reads and
// never selects (apps/relay/PROTOCOL.md § Connections). A credential for a browser has to be made of
// characters a subprotocol name allows, which a signed ticket is.
export const RELAY_SUBPROTOCOL = 'acorn.relay.v1'
const RELAY_CREDENTIAL_PREFIX = 'acorn.credential.'
export const relayCredentialProtocols = (credential: string): string[] => [
  RELAY_SUBPROTOCOL,
  `${RELAY_CREDENTIAL_PREFIX}${credential}`,
]
// The credential in an upgrade request's `Sec-WebSocket-Protocol` header, if it offered one.
export const credentialFromProtocols = (header: string | undefined): string | undefined =>
  header
    ?.split(',')
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith(RELAY_CREDENTIAL_PREFIX))
    ?.slice(RELAY_CREDENTIAL_PREFIX.length)

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

// --- Preview names (docs/relay/phone-channel.md § Previews) ---
// A preview is `<preview>.<node>.<preview domain>`. The account service, the relay, and the Node each need a
// Node's label and none can tell another, so all three compute it from the Node's ID.
const encoder = new TextEncoder()

// Opaque to anyone without the Node ID, and fixed for a Node. A certificate transparency log publishes
// it, and the relay sees it, so it must not be the Node ID itself.
export async function previewNodeLabel(nodeId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`acorn-preview-node:${nodeId}`))
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// A preview domain as the account service names it: a host name and an optional port, with no scheme.
// The port is for a development flow, and a certificate and a server name never carry one.
export function previewDomainHost(domain: string): string {
  return domain.replace(/:\d+$/, '')
}

// The two labels a server name carries under the preview domain, or null when it isn't one.
export function parsePreviewName(serverName: string, domainHost: string): { preview: string; node: string } | null {
  const suffix = `.${domainHost}`
  if (!serverName.endsWith(suffix)) return null
  const labels = serverName.slice(0, -suffix.length).split('.')
  const [preview, node] = labels
  return labels.length === 2 && /^[a-z0-9-]{1,63}$/.test(preview!) && /^[a-z0-9-]{1,63}$/.test(node!)
    ? { preview: preview!, node: node! }
    : null
}

// What a client sends to publish an ACME DNS-01 answer: the base64url SHA-256 of a key authorization.
export const ACME_CHALLENGE_VALUE = /^[A-Za-z0-9_-]{43}$/
