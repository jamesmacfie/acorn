import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  ASSERTION_LIFETIME_SECONDS,
  DEVICE_CODE_GRANT,
  TICKET_LIFETIME_SECONDS,
  accountErrorSchema,
  accountKeysSchema,
  accountPaths,
  accountSchema,
  assertionClaimsSchema,
  assertionResponseSchema,
  credentialClaimsSchema,
  deviceCodeResponseSchema,
  registerNodeResponseSchema,
  revokedCredentialsSchema,
  ticketClaimsSchema,
  ticketResponseSchema,
  tokenResponseSchema,
  type AccountKeys,
  type TokenResponse,
} from '@acorn/protocol/account.ts'
import { verifyToken } from '@acorn/protocol/accountToken.ts'
import { startAccountStub, type AccountStub } from './accountStub'

// The account API's conformance suite (docs/account-api.md § Conformance tests). It takes a base URL,
// so one set of checks holds every implementation to the same schemas: by default it starts the
// stand-in, and `ACORN_ACCOUNT_CONTRACT_URL=<base URL>` points it at another service instead, which
// must answer `POST /_test/approve` as the stand-in does.

const external = process.env.ACORN_ACCOUNT_CONTRACT_URL
let stub: AccountStub | undefined
let base = external ?? ''

beforeAll(async () => {
  if (external) return
  stub = await startAccountStub({ approveAs: false })
  base = stub.url
})
afterAll(() => stub?.close())

type Call = { token?: string; body?: unknown }
async function call<S extends z.ZodType>(method: string, path: string, { token, body }: Call = {}, schema?: S) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const json: unknown = text ? JSON.parse(text) : undefined
  return { status: response.status, json, data: schema && response.ok ? (schema.parse(json) as z.infer<S>) : undefined }
}

async function expectError(result: { status: number; json: unknown }, status: number, code: string) {
  expect(result.status).toBe(status)
  expect(accountErrorSchema.parse(result.json).error).toBe(code)
}

// A device flow, approved the way a person would approve it in the browser.
async function signIn(login: string): Promise<TokenResponse> {
  const code = (await call('POST', accountPaths.deviceCode, { body: {} }, deviceCodeResponseSchema)).data!
  const poll = { grantType: DEVICE_CODE_GRANT, deviceCode: code.deviceCode }
  await expectError(await call('POST', accountPaths.token, { body: poll }), 400, 'authorization_pending')
  await fetch(`${base}/_test/approve`, {
    method: 'POST',
    body: JSON.stringify({ userCode: code.userCode, login }),
  })
  return (await call('POST', accountPaths.token, { body: poll }, tokenResponseSchema)).data!
}

const fingerprint = 'ab'.repeat(32)
const register = (token: string, nodeId: string) =>
  call('PUT', accountPaths.node(nodeId), { token, body: { label: 'Laptop', fingerprint } }, registerNodeResponseSchema)

describe('the account API', () => {
  it('publishes the keys that verify what it signs', async () => {
    const keys = (await call('GET', accountPaths.keys, {}, accountKeysSchema)).data!
    expect(keys.keys.length).toBeGreaterThan(0)
  })

  describe('sign-in', () => {
    it('refuses a code request with a field it does not know', async () => {
      await expectError(
        await call('POST', accountPaths.deviceCode, { body: { surprise: true } }),
        400,
        'invalid_request',
      )
    })

    it('waits for approval, then issues tokens once', async () => {
      const tokens = await signIn('first-login')
      expect(tokens.account.name).toBe('first-login')
      const again = { grantType: DEVICE_CODE_GRANT, deviceCode: 'unknown-code' }
      await expectError(await call('POST', accountPaths.token, { body: again }), 400, 'invalid_grant')
    })

    it('knows an account by the same ID the next time it signs in', async () => {
      const first = await signIn('returning-login')
      const second = await signIn('returning-login')
      expect(second.account.id).toBe(first.account.id)
      expect(second.account.id).not.toBe('returning-login')
    })

    it('rotates the refresh token, so each works once', async () => {
      const tokens = await signIn('refreshing-login')
      const refresh = { grantType: 'refresh_token', refreshToken: tokens.refreshToken }
      const renewed = (await call('POST', accountPaths.token, { body: refresh }, tokenResponseSchema)).data!
      expect(renewed.account.id).toBe(tokens.account.id)
      expect(renewed.refreshToken).not.toBe(tokens.refreshToken)
      await expectError(await call('POST', accountPaths.token, { body: refresh }), 400, 'invalid_grant')
    })

    it('answers who is signed in, and refuses a stranger', async () => {
      const tokens = await signIn('known-login')
      const account = (await call('GET', accountPaths.account, { token: tokens.accessToken }, accountSchema)).data!
      expect(account).toEqual(tokens.account)
      await expectError(await call('GET', accountPaths.account, { token: 'not-a-token' }), 401, 'invalid_token')
    })
  })

  describe('registering a Node', () => {
    it('refuses a registration the schema refuses', async () => {
      const { accessToken } = await signIn('strict-login')
      const path = accountPaths.node(randomUUID())
      const bad = (body: unknown) => call('PUT', path, { token: accessToken, body })
      await expectError(await bad({ label: 'Laptop', fingerprint: 'short' }), 400, 'invalid_request')
      await expectError(await bad({ label: 'Laptop', fingerprint, extra: 1 }), 400, 'invalid_request')
      await expectError(
        await call('PUT', accountPaths.node('not-a-uuid'), { token: accessToken, body: {} }),
        400,
        'invalid_request',
      )
    })

    it('needs a signed-in account', async () => {
      await expectError(await register('not-a-token', randomUUID()), 401, 'invalid_token')
    })

    it('issues a credential that names the Node and its owner, and replaces the last one', async () => {
      const { accessToken, account } = await signIn('owner-login')
      const nodeId = randomUUID()
      const first = (await register(accessToken, nodeId)).data!
      const claims = await verifyToken(first.relay.credential, 'credential', credentialClaimsSchema, first.keys)
      expect(claims).toMatchObject({ aud: 'relay', node: nodeId, sub: account.id })
      expect(claims).not.toHaveProperty('exp')

      const second = (await register(accessToken, nodeId)).data!
      const revoked = (await call('GET', accountPaths.revoked, {}, revokedCredentialsSchema)).data!
      expect(revoked.credentials).toContain(claims!.jti)
      expect(second.relay.credential).not.toBe(first.relay.credential)
    })

    it('does not give a Node to a second account', async () => {
      const nodeId = randomUUID()
      await register((await signIn('first-owner')).accessToken, nodeId)
      await expectError(await register((await signIn('second-owner')).accessToken, nodeId), 409, 'conflict')
    })
  })

  describe('tickets and assertions', () => {
    async function ownedNode() {
      const tokens = await signIn(`owner-${randomUUID()}`)
      const nodeId = randomUUID()
      const { keys } = (await register(tokens.accessToken, nodeId)).data!
      return { tokens, nodeId, keys }
    }
    const ask = (path: string, token: string, nodeId: string) => call('POST', path, { token, body: { nodeId } })

    it('issues a five-minute ticket for a Node the account owns', async () => {
      const { tokens, nodeId, keys } = await ownedNode()
      const { ticket, expiresAt } = (
        await call('POST', accountPaths.tickets, { token: tokens.accessToken, body: { nodeId } }, ticketResponseSchema)
      ).data!
      const claims = await verifyToken(ticket, 'ticket', ticketClaimsSchema, keys)
      expect(claims).toMatchObject({ aud: 'relay', node: nodeId, sub: tokens.account.id, exp: expiresAt })
      expect(claims!.exp - claims!.iat).toBe(TICKET_LIFETIME_SECONDS)
    })

    it('issues a two-minute assertion with the Node as its audience', async () => {
      const { tokens, nodeId, keys } = await ownedNode()
      const { assertion } = (
        await call(
          'POST',
          accountPaths.assertions,
          { token: tokens.accessToken, body: { nodeId } },
          assertionResponseSchema,
        )
      ).data!
      const claims = await verifyToken(assertion, 'assertion', assertionClaimsSchema, keys)
      expect(claims).toMatchObject({ aud: nodeId, sub: tokens.account.id })
      expect(claims!.exp - claims!.iat).toBe(ASSERTION_LIFETIME_SECONDS)
      // A ticket and an assertion are not interchangeable.
      expect(await verifyToken(assertion, 'ticket', ticketClaimsSchema, keys)).toBeNull()
    })

    it('answers an account that does not own the Node as if it did not exist', async () => {
      const { nodeId } = await ownedNode()
      const stranger = await signIn(`stranger-${randomUUID()}`)
      await expectError(await ask(accountPaths.tickets, stranger.accessToken, nodeId), 404, 'not_found')
      await expectError(await ask(accountPaths.assertions, stranger.accessToken, nodeId), 404, 'not_found')
      await expectError(await ask(accountPaths.tickets, stranger.accessToken, randomUUID()), 404, 'not_found')
    })

    it('needs a signed-in account', async () => {
      await expectError(await ask(accountPaths.tickets, 'not-a-token', randomUUID()), 401, 'invalid_token')
    })

    it('stops issuing for a Node once it is removed, and revokes its credential', async () => {
      const { tokens, nodeId, keys } = await ownedNode()
      const stranger = await signIn(`stranger-${randomUUID()}`)
      const registered = (await register(tokens.accessToken, nodeId)).data!
      const credential = await verifyToken(
        registered.relay.credential,
        'credential',
        credentialClaimsSchema,
        keys as AccountKeys,
      )

      await expectError(
        await call('DELETE', accountPaths.node(nodeId), { token: stranger.accessToken }),
        404,
        'not_found',
      )
      expect((await call('DELETE', accountPaths.node(nodeId), { token: tokens.accessToken })).status).toBe(204)
      const revoked = (await call('GET', accountPaths.revoked, {}, revokedCredentialsSchema)).data!
      expect(revoked.credentials).toContain(credential!.jti)
      await expectError(await ask(accountPaths.tickets, tokens.accessToken, nodeId), 404, 'not_found')
    })
  })
})
