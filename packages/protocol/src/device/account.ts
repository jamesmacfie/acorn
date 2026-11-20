import { z } from 'zod'
import { ACME_CHALLENGE_VALUE, relayRouteSchema } from '../transport/relay.ts'
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
  preview: `${ACCOUNT_API_PREFIX}/preview`,
  previewChallenge: `${ACCOUNT_API_PREFIX}/preview/challenge`,
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
  // A label the asker chose, shown beside the code on the approval page. Anyone can send any name, so it
  // proves nothing about who is asking (docs/account-api.md#sign-in).
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

// --- Preview: the names a Node serves its tasks' apps under, and the certificate for them ---

// Where previews are served, and the certificate authority that domain's DNS zone allows. The domain is
// a host name and an optional port, with no scheme.
export const previewResponseSchema = z.object({ domain: z.string().min(1), acmeDirectory: z.string().url() })
export type PreviewResponse = z.infer<typeof previewResponseSchema>

// The answer to a DNS-01 challenge, published as the TXT record `_acme-challenge.<node label>.<domain>`. A
// Node can set the record for its own label only, because the service takes the Node from its credential.
export const previewChallengeRequestSchema = z.strictObject({ value: z.string().regex(ACME_CHALLENGE_VALUE) })
export type PreviewChallengeRequest = z.infer<typeof previewChallengeRequestSchema>

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
  PreviewResponse: previewResponseSchema,
  PreviewChallengeRequest: previewChallengeRequestSchema,
  RevokedCredentials: revokedCredentialsSchema,
  Error: accountErrorSchema,
} as const

// --- The Slack gateway API (docs/account-api/slack-gateway.md) ---
// What Slack, a Node, and the account service's Slack gateway say to each other. It has a version of
// its own in its path, and docs/schemas/slack-gateway-v1.json is generated from the schemas below. A
// breaking change is a new `/slack/v2` and a new schema file. Requests are strict and answers are open,
// as in the account API.
export const SLACK_GATEWAY_API_VERSION = 1
const PREFIX = `/slack/v${SLACK_GATEWAY_API_VERSION}`

export const slackGatewayPaths = {
  // Slack calls these, signed with the app's signing secret.
  events: `${PREFIX}/events`,
  interactions: `${PREFIX}/interactions`,
  commands: `${PREFIX}/commands`,
  oauthCallback: `${PREFIX}/oauth/callback`,
  // A Node calls these with the account's access token.
  links: `${PREFIX}/links`,
  link: (teamId: string): string => `${PREFIX}/links/${encodeURIComponent(teamId)}`,
  calls: `${PREFIX}/calls`,
  grant: (teamId: string, channelId: string, threadTs: string): string =>
    `${PREFIX}/grants/${[teamId, channelId, threadTs].map(encodeURIComponent).join('/')}`,
}

// Where the gateway delivers on a Node, through the relay. The last segment is the plugin the gateway
// token's `scope` names.
export const SLACK_GATEWAY_NODE_PATH = '/v1/gateway/slack/events'

// Slack's IDs: a team `T…`, a user `U…` or `W…`, a channel `C…`, `G…`, or `D…`.
const slackId = z.string().regex(/^[A-Z0-9]{2,40}$/)

// --- Links: one Slack user in one team, linked to one account and one Node ---

export const createSlackLinkRequestSchema = z.strictObject({ nodeId })
export const createSlackLinkResponseSchema = z.object({
  // The account website's page that runs Sign in with Slack.
  url: z.string().url(),
  // Epoch seconds. Ten minutes after the request.
  expiresAt: z.number().int(),
})
export type CreateSlackLinkResponse = z.infer<typeof createSlackLinkResponseSchema>

const slackLinkSchema = z.object({
  teamId: slackId,
  teamName: z.string(),
  slackUserId: slackId,
  slackUserName: z.string(),
  nodeId,
})
export type SlackLink = z.infer<typeof slackLinkSchema>
export const listSlackLinksResponseSchema = z.object({ links: z.array(slackLinkSchema) })

// --- Calls: the Slack Web API, made with the team's bot token, held to what the Node's grants allow ---

const SLACK_CALL_METHODS = [
  'chat.postMessage',
  'chat.update',
  'chat.delete',
  'chat.postEphemeral',
  'reactions.add',
  'reactions.remove',
  'conversations.replies',
  'chat.getPermalink',
  'users.info',
  // Not a Slack method: posts `args.body` to `args.url`, a `response_url` on hooks.slack.com.
  'respond',
] as const
export type SlackCallMethod = (typeof SLACK_CALL_METHODS)[number]

export const slackCallRequestSchema = z.strictObject({
  teamId: slackId,
  method: z.enum(SLACK_CALL_METHODS),
  args: z.record(z.string(), z.unknown()),
})
export const slackCallResponseSchema = z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) })

// --- Delivery: what the gateway posts to a Node ---

export const slackDeliverySchema = z.strictObject({
  // Slack's `event_id` for an event. For a click or a command, which have none, an ID the gateway made.
  eventId: z.string().min(1).max(100),
  // `grant`: the thread is this Node's. `sender`: the sender is this Node's owner.
  routedBy: z.enum(['grant', 'sender']),
  kind: z.enum(['event', 'interaction', 'command']),
  // Slack's JSON, as Slack sent it: the whole event callback, with `team_id` and `event`, a click's payload, or a
  // command's fields.
  payload: z.record(z.string(), z.unknown()),
})
export type SlackDelivery = z.infer<typeof slackDeliverySchema>
const slackDeliveryAnswerSchema = z.object({ ok: z.literal(true) })

// --- Errors: the account API's shape, with its codes these routes answer and five of their own ---

const SLACK_GATEWAY_ERROR_CODES = [
  'invalid_request',
  'invalid_token',
  'not_found',
  'conflict',
  'not_installed',
  'not_linked',
  'not_granted',
  'rate_limited',
  'slack_error',
] as const
export const slackGatewayErrorSchema = z.object({
  error: z.enum(SLACK_GATEWAY_ERROR_CODES),
  // For `slack_error`, Slack's own error string.
  message: z.string().optional(),
  // For `rate_limited`, seconds to wait.
  retryAfter: z.number().int().nonnegative().optional(),
})
export type SlackGatewayError = z.infer<typeof slackGatewayErrorSchema>

export const slackGatewayMessages = {
  CreateLinkRequest: createSlackLinkRequestSchema,
  CreateLinkResponse: createSlackLinkResponseSchema,
  Link: slackLinkSchema,
  ListLinksResponse: listSlackLinksResponseSchema,
  CallRequest: slackCallRequestSchema,
  CallResponse: slackCallResponseSchema,
  Delivery: slackDeliverySchema,
  DeliveryAnswer: slackDeliveryAnswerSchema,
  Error: slackGatewayErrorSchema,
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

// "A gateway of the service's own, delivering for plugin `scope`, to Node `aud` owned by account `sub`."
// One request within 60 seconds (docs/account-api/slack-gateway.md § The gateway token).
export const GATEWAY_TOKEN_LIFETIME_SECONDS = 60
export const gatewayClaimsSchema = z.object({
  ...claims,
  aud: nodeId,
  exp: instant,
  scope: z.string().regex(/^[a-z][a-z0-9-]*$/),
})

export const TOKEN_TYPES = {
  ticket: 'acorn-relay-ticket+jwt',
  credential: 'acorn-relay-credential+jwt',
  assertion: 'acorn-account-assertion+jwt',
  gateway: 'acorn-gateway+jwt',
} as const
