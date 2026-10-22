import { z } from 'zod'
import { relayRouteSchema } from '../transport/relay.ts'
import { accountKeysSchema } from './accountKeys.ts'

export { accountKeysSchema, type AccountKeys } from './accountKeys.ts'

// The account API (docs/account-api.md): what the sign-in plugin, the relay, and the hosted account
// service say to each other. It's a public interface, so it has a version of its own in its path,
// separate from the Node API's `/v1`, and the published JSON schemas in docs/schemas/account-v1.json
// are generated from the schemas below. A breaking change is a new `/account/v2` and a new file.
export const ACCOUNT_API_VERSION = 1
export const ACCOUNT_API_PREFIX = `/account/v${ACCOUNT_API_VERSION}`

export const accountPaths = {
  keys: `${ACCOUNT_API_PREFIX}/keys`,
  revoked: `${ACCOUNT_API_PREFIX}/relay/revoked`,
  deviceCode: `${ACCOUNT_API_PREFIX}/device/code`,
  token: `${ACCOUNT_API_PREFIX}/token`,
  account: `${ACCOUNT_API_PREFIX}/account`,
  nodes: `${ACCOUNT_API_PREFIX}/nodes`,
  node: (nodeId: string): string => `${ACCOUNT_API_PREFIX}/nodes/${nodeId}`,
  tickets: `${ACCOUNT_API_PREFIX}/tickets`,
  assertions: `${ACCOUNT_API_PREFIX}/assertions`,
  // Where the phone app sends a person to sign in on the service's own page. It takes `?next=<path on
  // the service's own origin>` and sends the browser back there with a session cookie.
  browserSignIn: `${ACCOUNT_API_PREFIX}/browser/sign-in`,
}

// A browser served by the account website calls the routes that take an access token with the website's
// session cookie instead, and sends this header with it. A page on another site can't add a header like it
// without the service's say-so, so a cookie alone never acts for the person.
export const ACCOUNT_BROWSER_HEADER = 'x-acorn-account'

// Requests are strict, like the enrollment payload: a field the service doesn't know is a mistake to
// refuse, not to ignore. Responses are open, because a client that refused an answer for growing a
// field would be one no service could extend.
const nodeId = z.string().uuid()
// The public half of a Node's channel key pair, the Ed25519 key a phone pins, as 64 lowercase hex characters.
const channelKey = z.string().regex(/^[0-9a-f]{64}$/)

// --- Sign-in: the OAuth device authorization grant, RFC 8628, with JSON bodies ---

export const deviceCodeRequestSchema = z.strictObject({
  // What the person sees beside the code when they approve, so they can tell it's their own sign-in.
  deviceName: z.string().min(1).max(100).optional(),
})
export type DeviceCodeRequest = z.infer<typeof deviceCodeRequestSchema>

export const deviceCodeResponseSchema = z.object({
  deviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.string().url(),
  expiresIn: z.number().int().positive(),
  // Seconds between polls. A `slow_down` answer asks for longer.
  interval: z.number().int().positive(),
})
export type DeviceCodeResponse = z.infer<typeof deviceCodeResponseSchema>

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export const tokenRequestSchema = z.discriminatedUnion('grantType', [
  z.strictObject({ grantType: z.literal(DEVICE_CODE_GRANT), deviceCode: z.string().min(1) }),
  z.strictObject({ grantType: z.literal('refresh_token'), refreshToken: z.string().min(1) }),
])
export type TokenRequest = z.infer<typeof tokenRequestSchema>

// An account is a person, and its ID has no relationship to any sign-in provider's user ID.
export const accountSchema = z.object({
  id: z.string().min(1),
  // What to show: a GitHub login today.
  name: z.string().min(1),
})
export type Account = z.infer<typeof accountSchema>

// The refresh token is single-use. Every refresh answers with a new one, and the old one stops working.
export const tokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  account: accountSchema,
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

// --- Nodes, relay credentials, tickets, and assertions ---

export const registerNodeRequestSchema = z.strictObject({
  label: z.string().min(1).max(100),
  // sha256 of the Node's certificate, lowercase hex: the value a client pins.
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  // What a phone pins (docs/relay/phone-channel.md). A Node sends it every time. It's optional so a service
  // and a Node from before the phone keep working together, and the phone can't reach a Node without one.
  channelKey: channelKey.optional(),
})
export type RegisterNodeRequest = z.infer<typeof registerNodeRequestSchema>

// Registering again replaces the Node's relay credential, and the old one stops working.
export const registerNodeResponseSchema = z.object({
  relay: z.object({ url: relayRouteSchema.shape.url, credential: z.string().min(1) }),
  keys: accountKeysSchema,
})
export type RegisterNodeResponse = z.infer<typeof registerNodeResponseSchema>

// A Node the account owns, as its service remembers it: where it is, and the certificate a client pins.
export const accountNodeSchema = z.object({
  nodeId,
  label: z.string().min(1),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  // The key the Node registered for phones. Absent for a Node that registered before phones existed.
  channelKey: channelKey.optional(),
  // The relay the Node dials. The account service vouches for the fingerprint, not for whether the Node
  // is connected: it can't see that.
  relayUrl: relayRouteSchema.shape.url,
})
export type AccountNode = z.infer<typeof accountNodeSchema>

export const listNodesResponseSchema = z.object({ nodes: z.array(accountNodeSchema) })
export type ListNodesResponse = z.infer<typeof listNodesResponseSchema>

export const ticketRequestSchema = z.strictObject({ nodeId })
export const ticketResponseSchema = z.object({
  ticket: z.string().min(1),
  // Epoch seconds, the same as the ticket's own `exp`.
  expiresAt: z.number().int(),
  // Where the Node's relay is, so a client that knows only the Node ID can reach it.
  relayUrl: relayRouteSchema.shape.url,
})
export type TicketResponse = z.infer<typeof ticketResponseSchema>

export const assertionRequestSchema = z.strictObject({ nodeId })
export const assertionResponseSchema = z.object({ assertion: z.string().min(1), expiresAt: z.number().int() })
export type AssertionResponse = z.infer<typeof assertionResponseSchema>

// Credentials removed on purpose. The relay polls it, and drops a Node that presents one.
export const revokedCredentialsSchema = z.object({ credentials: z.array(z.string()) })

// --- Errors ---

export const ACCOUNT_ERROR_CODES = [
  // The token endpoint, as RFC 8628 names them.
  'authorization_pending',
  'slow_down',
  'expired_token',
  'access_denied',
  'invalid_grant',
  'invalid_request',
  // The rest of the API.
  'invalid_token',
  'not_found',
  'conflict',
] as const
export const accountErrorSchema = z.object({ error: z.enum(ACCOUNT_ERROR_CODES), message: z.string().optional() })
export type AccountError = z.infer<typeof accountErrorSchema>

// The messages a request body may carry and an answer may hold, by name, for the published schema.
export const accountMessages = {
  DeviceCodeRequest: deviceCodeRequestSchema,
  DeviceCodeResponse: deviceCodeResponseSchema,
  TokenRequest: tokenRequestSchema,
  TokenResponse: tokenResponseSchema,
  Account: accountSchema,
  Keys: accountKeysSchema,
  RegisterNodeRequest: registerNodeRequestSchema,
  RegisterNodeResponse: registerNodeResponseSchema,
  ListNodesResponse: listNodesResponseSchema,
  TicketRequest: ticketRequestSchema,
  TicketResponse: ticketResponseSchema,
  AssertionRequest: assertionRequestSchema,
  AssertionResponse: assertionResponseSchema,
  RevokedCredentials: revokedCredentialsSchema,
  Error: accountErrorSchema,
} as const

// --- Signed tokens: what the account service signs, and what its holder presents ---
// The format is in ./accountToken.ts. These are the claims inside.

const instant = z.number().int()
const claims = { iss: z.string().min(1), sub: z.string().min(1), jti: z.string().min(1), iat: instant }

// "Account `sub` may open a stream to Node `node`." Five minutes.
export const TICKET_LIFETIME_SECONDS = 300
export const ticketClaimsSchema = z.object({ ...claims, aud: z.literal('relay'), node: nodeId, exp: instant })

// "I'm Node `node`, owned by account `sub`." No expiry: it ends when the Node is removed or registers again.
export const credentialClaimsSchema = z.object({ ...claims, aud: z.literal('relay'), node: nodeId })

// "Account `sub` is signed in", for the Node `aud`. Two minutes.
export const ASSERTION_LIFETIME_SECONDS = 120
export const assertionClaimsSchema = z.object({ ...claims, aud: nodeId, exp: instant })

export const TOKEN_TYPES = {
  ticket: 'acorn-relay-ticket+jwt',
  credential: 'acorn-relay-credential+jwt',
  assertion: 'acorn-account-assertion+jwt',
} as const
