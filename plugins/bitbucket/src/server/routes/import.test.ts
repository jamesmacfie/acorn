import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, testGate, type AppEnv, type Env, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { repositories } from '../../node/schema'
import type { BitbucketAccount } from '../account'
import { bitbucketImport } from './import'

describe('Bitbucket project importer', () => {
  let plugin: TestPluginDb
  let app: Hono<AppEnv>
  const clone = vi.fn()
  const byRepository = vi.fn()

  beforeEach(async () => {
    plugin = makeTestPluginDb('bitbucket')
    await plugin.db.insert(repositories).values({
      connectionId: 'connection-1',
      repo: 'acme/api',
      path: 'acme/api',
      name: 'api',
      fetchedAt: Date.now(),
    })
    clone.mockReset().mockResolvedValue({ cloneId: 'run-1' })
    byRepository.mockReset().mockResolvedValue(null)
    const core = { projects: { byRepository, clone } } as unknown as Pick<CoreServices, 'projects'>
    const account = { connectionId: () => 'connection-1' } as unknown as BitbucketAccount
    app = new Hono<AppEnv>()
      .use('/api/*', ...testGate({ kind: 'device', deviceId: 'device', userId: 'owner' }))
      .route('/api/import', bitbucketImport(plugin.db, core, account))
  })

  afterEach(() => plugin.cleanup())

  const post = async () => {
    const response = await app.fetch(
      new Request('http://acorn.test/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositories: [{ repository: 'acme/api', action: 'clone', parentDir: '/checkouts' }] }),
      }),
      {} as Env,
    )
    return ((await response.json()) as { results: unknown[] }).results[0]
  }

  // Core checks the folder, clones in the background, and links the row once it has its folder.
  it('hands a clone to core and answers with the run', async () => {
    expect(await post()).toEqual({ repository: 'acme/api', action: 'clone', ok: true, cloneId: 'run-1' })
    expect(clone).toHaveBeenCalledWith({
      url: 'https://bitbucket.org/acme/api.git',
      parentDir: '/checkouts',
      name: 'api',
      fillProjectId: undefined,
    })
  })

  it('gives a clone to a path-less project for the same repository', async () => {
    byRepository.mockResolvedValue({ id: 'placeholder-id', path: null })
    await post()
    expect(byRepository).toHaveBeenCalledWith('bitbucket', 'acme/api')
    expect(clone).toHaveBeenCalledWith(expect.objectContaining({ fillProjectId: 'placeholder-id' }))
  })

  it('reports a clone core refused', async () => {
    clone.mockRejectedValue(new Error("/checkouts doesn't exist on this Node."))
    expect(await post()).toEqual({
      repository: 'acme/api',
      action: 'clone',
      ok: false,
      error: "/checkouts doesn't exist on this Node.",
    })
  })
})
