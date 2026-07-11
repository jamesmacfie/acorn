import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { createAutomationApp } from '../../../core/server/publicApi/app'
import { IdempotencyStore } from '../../../core/server/publicApi/idempotency'
import { AutomationApiRegistry } from '../../../core/server/publicApi/registry'
import { TokenService } from '../../../core/server/publicApi/tokenService'
import { buildGithubPublicApi } from './publicApi'
import { GitHubPublicService } from './publicService'

const HOST = '127.0.0.1:4318'

describe('GitHub public refresh endpoints', () => {
  let t: TestDb
  let app: ReturnType<typeof createAutomationApp>
  let readToken: string
  let writeToken: string
  let service: GitHubPublicService

  beforeEach(async () => {
    t = makeTestDb()
    const tokens = new TokenService(t.db)
    readToken = (await tokens.create({ userId: 'octocat', name: 'read', scopes: ['read'], expiresAt: null })).token
    writeToken = (await tokens.create({ userId: 'octocat', name: 'write', scopes: ['read', 'write'], expiresAt: null })).token
    service = new GitHubPublicService({
      db: t.db,
      blobs: { get: async () => null, put: async () => undefined },
      resolveToken: async () => 'github-token',
    })
    vi.spyOn(service, 'refreshPulls').mockResolvedValue({ refreshed: true })
    vi.spyOn(service, 'refreshPull').mockResolvedValue({ refreshed: true })
    const registry = new AutomationApiRegistry()
    registry.registerContribution(buildGithubPublicApi(service), 'github')
    app = createAutomationApp({
      snapshot: registry.freeze(),
      tokens,
      idempotency: new IdempotencyStore(t.db),
      allowedHost: HOST,
    })
  })

  afterEach(() => {
    t.cleanup()
    vi.restoreAllMocks()
  })

  const request = (path: string, token: string) =>
    app.fetch(
      new Request(`http://${HOST}${path}`, {
        method: 'POST',
        headers: { host: HOST, authorization: `Bearer ${token}` },
      }),
      {} as Env,
    )

  it('requires write scope and refreshes the open pull list', async () => {
    const path = '/api/v1/plugins/github/repos/acme/web/pulls/refresh'
    const denied = await request(path, readToken)
    expect(denied.status).toBe(403)
    expect((await denied.json()).error.code).toBe('insufficient_scope')

    const refreshed = await request(path, writeToken)
    expect(refreshed.status).toBe(200)
    expect((await refreshed.json()).data).toEqual({ refreshed: true })
    expect(service.refreshPulls).toHaveBeenCalledWith('octocat', 'acme', 'web')
  })

  it('refreshes one pull and validates its number', async () => {
    const refreshed = await request('/api/v1/plugins/github/repos/acme/web/pulls/42/refresh', writeToken)
    expect(refreshed.status).toBe(200)
    expect((await refreshed.json()).data).toEqual({ refreshed: true })
    expect(service.refreshPull).toHaveBeenCalledWith('octocat', 'acme', 'web', 42)

    const malformed = await request('/api/v1/plugins/github/repos/acme/web/pulls/nope/refresh', writeToken)
    expect(malformed.status).toBe(422)
    expect((await malformed.json()).error.code).toBe('validation_failed')
  })

  it('publishes both write-scoped operations in OpenAPI', async () => {
    const response = await app.fetch(
      new Request(`http://${HOST}/api/v1/openapi.json`, {
        headers: { host: HOST, authorization: `Bearer ${readToken}` },
      }),
      {} as Env,
    )
    const document = await response.json()
    expect(document.paths['/api/v1/plugins/github/repos/{owner}/{repo}/pulls/refresh'].post['x-acorn-scope']).toBe('write')
    expect(document.paths['/api/v1/plugins/github/repos/{owner}/{repo}/pulls/{number}/refresh'].post['x-acorn-scope']).toBe('write')
  })
})
