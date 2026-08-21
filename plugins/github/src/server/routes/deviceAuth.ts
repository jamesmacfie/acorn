import { Hono } from 'hono'
import { type AppEnv, connectProvider, ownerId, providerError, respondError } from '@acorn/plugin-api/node'
import { GITHUB_PROVIDER } from '../githubToken'

// GitHub OAuth via the device authorization grant, RFC 8628 (docs/github-integration.md §
// Connecting, for why device flow wins over the redirect web flow).

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const SCOPES = 'repo read:org read:user'

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type TokenResponse = { access_token?: string; scope?: string; error?: string; error_description?: string }

// GitHub's documented terminal errors for the poll. `authorization_pending` and `slow_down` are the
// non-terminal pair and are reported back so the client keeps polling at the advertised interval.
const TERMINAL_ERRORS = new Set(['expired_token', 'access_denied', 'unsupported_grant_type', 'incorrect_client_credentials'])

const form = (body: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  body: new URLSearchParams(body).toString(),
})

export const githubDeviceAuth = (clientId: () => string) => new Hono<AppEnv>()
  // Open a device-flow window. Returns what the UI must display: the code, where to type it, and how
  // often to poll. The device_code is a bearer for the pending grant, so it is returned to the
  // client rather than held server-side, since it authorizes nothing on this node and keeping
  // pending state would only add a lifecycle to get wrong.
  .post('/auth/device/start', async (c) => {
    ownerId(c) // owner-gated: only the owner may begin connecting an account
    const id = clientId()
    if (!id) return respondError(c, 503, 'provider_unavailable', ['GitHub integration is not configured on this node.'])
    const response = await fetch(DEVICE_CODE_URL, form({ client_id: id, scope: SCOPES }))
    if (!response.ok) return respondError(c, 502, 'provider_unavailable', ['GitHub did not issue a device code.'])
    const body = (await response.json().catch(() => ({}))) as Partial<DeviceCodeResponse>
    if (!body.device_code || !body.user_code || !body.verification_uri) {
      return respondError(c, 502, 'provider_unavailable', ['GitHub returned an unusable device code response.'])
    }
    return c.json({
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresIn: body.expires_in ?? 900,
      // GitHub's minimum is 5s; honour whatever it asks for and never poll faster.
      interval: body.interval ?? 5,
    })
  })
  // Poll once. The client drives the interval, so this is a single attempt and never blocks:
  // long-polling here would tie up a request slot for up to 15 minutes per pending connection.
  .post('/auth/device/poll', async (c) => {
    const userId = ownerId(c)
    const { deviceCode } = (await c.req.json().catch(() => ({}))) as { deviceCode?: string }
    if (!deviceCode) return respondError(c, 400, 'bad_request')

    const id = clientId()
    if (!id) return respondError(c, 503, 'provider_unavailable', ['GitHub integration is not configured on this node.'])
    const response = await fetch(
      TOKEN_URL,
      form({
        client_id: id,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    )
    const body = (await response.json().catch(() => ({}))) as TokenResponse

    if (body.error) {
      if (TERMINAL_ERRORS.has(body.error)) return c.json({ status: body.error === 'access_denied' ? 'denied' : 'expired' } as const)
      // authorization_pending / slow_down: not an error condition, just "not yet".
      return c.json({ status: 'pending', slowDown: body.error === 'slow_down' } as const)
    }
    if (!body.access_token) return respondError(c, 502, 'provider_unavailable', ['GitHub returned no access token.'])

    // Hand the token to the same path every other provider's connect uses: it validates against
    // GET /user, records the granted scopes, encrypts at rest and enforces maxConnections. A token
    // GitHub then rejects surfaces as 401, not as an uncaught 500, through the same mapping the core
    // connection routes use.
    try {
      const integration = await connectProvider(
        // Core's handle: this writes core's `integrations` row through core's own connectProvider and
        // touches none of this plugin's tables. `c.env.DB` rather than getDb() only because importing
        // from server/db is what the schema ratchet measures, and there is nothing about github's
        // schema in this call.
        c.env.DB,
        userId,
        { providerId: GITHUB_PROVIDER, credentials: { accessToken: body.access_token } },
        c.env.SECRETS,
      )
      // The token itself is never echoed back; the client only needs to know it worked. The machine
      // identity is not touched here, only minted at boot (core's ensureBoundIdentity); the GitHub
      // login is just this integration's account metadata.
      return c.json({ status: 'connected', integration } as const)
    } catch (error) {
      return providerError(c, error)
    }
  })
