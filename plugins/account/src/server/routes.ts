import { hostname } from 'node:os'
import { Hono } from 'hono'
import { z } from 'zod'
import { ticketRequestSchema } from '@acorn/protocol/account.ts'
import {
  type AppEnv,
  connectProvider,
  disconnectConnection,
  listProviderConnections,
  ownerId,
  providerCredential,
  providerError,
  requireDevice,
  respondError,
} from '@acorn/plugin-api/node'
import type { AccountState } from '../shared/state'
import { accountApi, AccountApiError } from './accountApi'
import { accountUrl } from './config'
import { ACCOUNT_PROVIDER } from './provider'
import { blocker, remoteAccessState, turnOff, turnOn } from './remoteAccess'

// The account plugin's routes, under /v1/p/account. Every one is for a paired device: signing in is a
// person at a keyboard, and a task's agent token must not be able to sign the Node in to its own account
// or ask for a relay ticket (the confused deputy `plugins/github`'s device routes close the same way).

const pollBody = z.strictObject({ deviceCode: z.string().min(1) })
const remoteAccessBody = z.strictObject({ enabled: z.boolean() })

// What the service refused with, in the plugin's terms.
const refusal = (c: Parameters<typeof respondError>[0], error: AccountApiError) =>
  error.code === 'invalid_token'
    ? respondError(c, 401, 'account_needs_sign_in', ['Sign in to your acorn account first.'])
    : error.code === 'not_found'
      ? respondError(c, 404, 'not_found', ['The account service doesn’t know that Node.'])
      : error.code === 'conflict'
        ? respondError(c, 409, 'conflict', ['Another account owns this Node.'])
        : respondError(c, 502, 'account_unavailable', ['The account service didn’t answer as expected.'])

export const accountRoutes = () =>
  new Hono<AppEnv>()
    .use('*', requireDevice)
    .get('/state', async (c) => {
      const [signedIn] = await listProviderConnections(c.env.DB, ownerId(c), ACCOUNT_PROVIDER)
      const account = signedIn?.account ? (JSON.parse(signedIn.account) as { id: string; label: string }) : null
      return c.json({
        configured: accountUrl() !== '',
        account: account && { id: account.id, name: account.label },
        remoteAccess: remoteAccessState(c),
      } satisfies AccountState)
    })
    // Open a device-flow window. The device code goes back to the client, which polls.
    .post('/auth/device/start', async (c) => {
      if (!accountUrl())
        return respondError(c, 503, 'account_unavailable', ['This copy of acorn has no account service.'])
      try {
        return c.json(await accountApi(accountUrl()).deviceCode(hostname().slice(0, 100) || 'acorn'))
      } catch (error) {
        return error instanceof AccountApiError ? refusal(c, error) : providerError(c, error)
      }
    })
    // Poll once. On approval the tokens become the Node's one sign-in connection.
    .post('/auth/device/poll', async (c) => {
      const body = pollBody.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return respondError(c, 400, 'bad_request')
      try {
        const tokens = await accountApi(accountUrl()).deviceToken(body.data.deviceCode)
        const integration = await connectProvider(
          c.env.DB,
          ownerId(c),
          {
            providerId: ACCOUNT_PROVIDER,
            credentials: {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresIn: String(tokens.expiresIn),
            },
          },
          c.env.SECRETS,
        )
        return c.json({ status: 'connected', integration } as const)
      } catch (error) {
        if (!(error instanceof AccountApiError)) return providerError(c, error)
        if (error.code === 'authorization_pending') return c.json({ status: 'pending' } as const)
        if (error.code === 'slow_down') return c.json({ status: 'pending', slowDown: true } as const)
        if (error.code === 'access_denied') return c.json({ status: 'denied' } as const)
        if (error.code === 'expired_token' || error.code === 'invalid_grant')
          return c.json({ status: 'expired' } as const)
        return refusal(c, error)
      }
    })
    .put('/remote-access', async (c) => {
      const body = remoteAccessBody.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return respondError(c, 400, 'bad_request')
      if (!body.data.enabled) return c.json(await turnOff(c))
      const blocked = blocker(c)
      if (blocked) return respondError(c, 409, 'relay_set_elsewhere', [blocked])
      const [signedIn] = await listProviderConnections(c.env.DB, ownerId(c), ACCOUNT_PROVIDER)
      const account = signedIn?.account ? (JSON.parse(signedIn.account) as { id: string }) : null
      if (!account) return respondError(c, 401, 'account_needs_sign_in', ['Sign in to your acorn account first.'])
      try {
        await turnOn(c, account)
        return c.json(remoteAccessState(c))
      } catch (error) {
        return error instanceof AccountApiError ? refusal(c, error) : providerError(c, error)
      }
    })
    // Signing out ends remote access first, so a Node that was reachable doesn't stay so with nobody
    // signed in to say so.
    .post('/sign-out', async (c) => {
      const result = await turnOff(c)
      for (const connection of await listProviderConnections(c.env.DB, ownerId(c), ACCOUNT_PROVIDER))
        await disconnectConnection(c.env.DB, ownerId(c), connection.id)
      return c.json(result)
    })
    // A relay ticket for one of the account's Nodes: what a client's custody asks this Node for before it
    // opens a stream to that Node through the relay.
    .post('/tickets', async (c) => {
      const body = ticketRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return respondError(c, 400, 'bad_request')
      const token = await providerCredential(c, ACCOUNT_PROVIDER)
      if (!token) return respondError(c, 401, 'account_needs_sign_in', ['Sign in to your acorn account first.'])
      try {
        return c.json(await accountApi(accountUrl()).ticket(token, body.data.nodeId))
      } catch (error) {
        return error instanceof AccountApiError ? refusal(c, error) : providerError(c, error)
      }
    })
