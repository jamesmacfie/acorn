import { Hono } from 'hono'
import { z } from 'zod'
import {
  type AppEnv,
  connectProvider,
  ownerId,
  providerError,
  requireDevice,
  respondError,
} from '@acorn/plugin-api/node'
import { GITLAB_ORIGIN } from '../config'
import { GITLAB_PROVIDER } from '../gitlabApi'
import { oauthTokens } from '../provider'

// gitlab.com sign-in through the device authorization grant, under /v1/p/gitlab/auth, RFC 8628, which GitLab serves from 17.1.
// The same shape as GitHub's (plugins/github/src/server/routes/deviceAuth.ts): the client paces the
// polling, and a granted token goes through connectProvider like every other connection. GitLab's
// tokens expire, so the refresh token and the expiry go with it.

const DEVICE_CODE_URL = `${GITLAB_ORIGIN}/oauth/authorize_device`
const TOKEN_URL = `${GITLAB_ORIGIN}/oauth/token`
// `api`, because the plugin writes comments and opens merge requests.
const SCOPES = 'api'

const pollBody = z.object({ deviceCode: z.string().min(1) })

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

const TERMINAL_ERRORS = new Set(['expired_token', 'access_denied', 'unsupported_grant_type', 'invalid_client'])

const form = (body: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  body: new URLSearchParams(body).toString(),
})

export const gitlabDeviceAuth = (clientId: () => string) =>
  new Hono<AppEnv>()
    // Owner-only, for the confused-deputy reason GitHub's route gives: a task's agent must not be able
    // to sign the owner's GitLab connection in to an account the agent controls.
    .use('/device/*', requireDevice)
    .post('/device/start', async (c) => {
      ownerId(c)
      const id = clientId()
      if (!id) return respondError(c, 503, 'provider_unavailable', ["This copy of acorn can't sign in to GitLab."])
      const response = await fetch(DEVICE_CODE_URL, form({ client_id: id, scope: SCOPES }))
      if (!response.ok) return respondError(c, 502, 'provider_unavailable', ['GitLab did not issue a device code.'])
      const body = (await response.json().catch(() => ({}))) as Partial<DeviceCodeResponse>
      if (!body.device_code || !body.user_code || !body.verification_uri)
        return respondError(c, 502, 'provider_unavailable', ['GitLab returned an unusable device code response.'])
      return c.json({
        deviceCode: body.device_code,
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        expiresIn: body.expires_in ?? 300,
        interval: body.interval ?? 5,
      })
    })
    .post('/device/poll', async (c) => {
      const userId = ownerId(c)
      const parsed = pollBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      const id = clientId()
      if (!id) return respondError(c, 503, 'provider_unavailable', ["This copy of acorn can't sign in to GitLab."])
      const response = await fetch(
        TOKEN_URL,
        form({
          client_id: id,
          device_code: parsed.data.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      )
      const body = (await response.json().catch(() => ({}))) as Parameters<typeof oauthTokens>[0] & { error?: string }
      if (body.error) {
        if (TERMINAL_ERRORS.has(body.error))
          return c.json({ status: body.error === 'access_denied' ? 'denied' : 'expired' } as const)
        return c.json({ status: 'pending', slowDown: body.error === 'slow_down' } as const)
      }
      const tokens = oauthTokens(body)
      if (!tokens) return respondError(c, 502, 'provider_unavailable', ['GitLab returned no access token.'])
      try {
        const integration = await connectProvider(
          c.env.DB,
          userId,
          {
            providerId: GITLAB_PROVIDER,
            credentials: {
              accessToken: tokens.secret,
              refreshToken: tokens.refreshToken,
              expiresAt: String(tokens.expiresAt),
            },
          },
          c.env.SECRETS,
        )
        return c.json({ status: 'connected', integration } as const)
      } catch (error) {
        return providerError(c, error)
      }
    })
