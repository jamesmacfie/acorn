import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../db'
import { eq } from 'drizzle-orm'
import { makeTestDb, type TestDb } from '../routes/testDb'
import { OauthAccountService } from './oauthAccountService'
import { TokenService } from './tokenService'

const ENC_KEY = '0'.repeat(64) // 32 bytes of zeros — fine for a test

describe('TokenService', () => {
  let t: TestDb
  beforeEach(() => {
    t = makeTestDb()
  })
  afterEach(() => t.cleanup())

  it('issues a well-formed token, stores only a hash, and authenticates it', async () => {
    const svc = new TokenService(t.db)
    const { token, metadata } = await svc.create({ userId: 'octocat', name: 'ci', scopes: ['read', 'write'], expiresAt: null })
    expect(token).toMatch(/^acorn_v1_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/)
    expect(metadata.scopes).toEqual(['read', 'write'])

    // stored row never contains the raw bearer
    const [row] = await t.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, metadata.id))
    expect(row.secretHash).toBeInstanceOf(Buffer)
    expect(JSON.stringify(row)).not.toContain(token.split('_').pop())

    const principal = await svc.authenticate(token)
    expect(principal?.tokenId).toBe(metadata.id)
    expect(principal?.scopes).toEqual(['read', 'write'])
    expect(principal?.userId).toBe('octocat')
  })

  it('rejects missing, malformed, unknown, wrong-secret, expired, and revoked tokens', async () => {
    const svc = new TokenService(t.db)
    const { token, metadata } = await svc.create({ userId: 'u', name: 'r', scopes: ['read'], expiresAt: null })

    expect(await svc.authenticate(undefined)).toBeNull()
    expect(await svc.authenticate('garbage')).toBeNull()
    expect(await svc.authenticate('acorn_v1_00000000-0000-0000-0000-000000000000_' + 'a'.repeat(43))).toBeNull()
    // right id, wrong secret
    const [id] = token.split('_').slice(2)
    expect(await svc.authenticate(`acorn_v1_${id}_${'b'.repeat(43)}`)).toBeNull()

    await svc.revoke('u', metadata.id)
    expect(await svc.authenticate(token)).toBeNull()
  })

  it('rejects an expired token', async () => {
    let clock = 1_000_000
    const svc = new TokenService(t.db, () => clock)
    const { token } = await svc.create({ userId: 'u', name: 'r', scopes: ['read'], expiresAt: 1_000_500 })
    expect(await svc.authenticate(token)).not.toBeNull()
    clock = 1_001_000
    expect(await svc.authenticate(token)).toBeNull()
  })

  it('revoke is idempotent, scoped to the owner, and notifies listeners', async () => {
    const svc = new TokenService(t.db)
    const { metadata } = await svc.create({ userId: 'owner', name: 'r', scopes: ['read'], expiresAt: null })
    const notified: string[] = []
    svc.onRevoked((id) => notified.push(id))

    expect(await svc.revoke('someone-else', metadata.id)).toBe(false) // not theirs → 404
    expect(await svc.revoke('owner', metadata.id)).toBe(true)
    expect(await svc.revoke('owner', metadata.id)).toBe(true) // idempotent
    expect(notified).toContain(metadata.id)
  })

  it('list returns metadata only, never a hash or secret', async () => {
    const svc = new TokenService(t.db)
    await svc.create({ userId: 'u', name: 'a', scopes: ['read'], expiresAt: null })
    const list = await svc.list('u')
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain('secretHash')
    expect(Object.keys(list[0])).toEqual(['id', 'name', 'prefix', 'scopes', 'createdAt', 'lastUsedAt', 'expiresAt', 'revokedAt'])
  })

  it('rejects a past expiry at creation', async () => {
    const svc = new TokenService(t.db, () => 1000)
    await expect(svc.create({ userId: 'u', name: 'a', scopes: ['read'], expiresAt: 500 })).rejects.toThrow(/future/)
  })
})

describe('OauthAccountService', () => {
  let t: TestDb
  beforeEach(() => {
    t = makeTestDb()
  })
  afterEach(() => t.cleanup())

  it('encrypts the access token at rest and resolves it back; rotation replaces it', async () => {
    const svc = new OauthAccountService(t.db, ENC_KEY)
    await svc.upsertGithub({ login: 'octocat', accessToken: 'gho_secret1', name: 'Octo', avatar: 'a', scopes: ['repo'] })

    const [row] = await t.db.select().from(schema.oauthAccounts)
    expect(row.encryptedAccessToken).not.toContain('gho_secret1')
    expect(await svc.resolveGithubToken('octocat')).toBe('gho_secret1')

    await svc.upsertGithub({ login: 'octocat', accessToken: 'gho_secret2', name: 'Octo', avatar: 'a', scopes: ['repo'] })
    expect(await svc.resolveGithubToken('octocat')).toBe('gho_secret2')
    const rows = await t.db.select().from(schema.oauthAccounts)
    expect(rows).toHaveLength(1) // upsert, not insert
  })

  it('links a token principal to its stored GitHub identity', async () => {
    const oauth = new OauthAccountService(t.db, ENC_KEY)
    await oauth.upsertGithub({ login: 'octocat', accessToken: 'x', name: 'Octo Cat', avatar: 'pic', scopes: [] })
    const tokens = new TokenService(t.db)
    const { token } = await tokens.create({ userId: 'octocat', name: 'r', scopes: ['read'], expiresAt: null })
    const principal = await tokens.authenticate(token)
    expect(principal?.user).toEqual({ login: 'octocat', name: 'Octo Cat', avatar: 'pic' })
  })
})
