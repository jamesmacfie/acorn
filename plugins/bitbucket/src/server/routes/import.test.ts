import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, testGate, type AppEnv, type Env, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { repositories } from '../../node/schema'
import type { BitbucketAccount } from '../account'
import { bitbucketImport } from './import'

describe('Bitbucket project importer', () => {
  // A clone needs a folder that's really there; the clone itself is mocked.
  const parentDir = tmpdir()
  let plugin: TestPluginDb
  let app: Hono<AppEnv>
  const gitOrThrow = vi.fn()
  const create = vi.fn()

  beforeEach(async () => {
    plugin = makeTestPluginDb('bitbucket')
    await plugin.db.insert(repositories).values({
      connectionId: 'connection-1',
      repo: 'acme/api',
      path: 'acme/api',
      name: 'api',
      fetchedAt: Date.now(),
    })
    gitOrThrow.mockReset().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    create.mockReset().mockResolvedValue({ id: 'project-1' })
    const core = {
      git: { gitOrThrow },
      projects: { byRepository: async () => null, create, update: async (id: string) => ({ id }) },
    } as unknown as Pick<CoreServices, 'projects' | 'git'>
    const account = { connectionId: () => 'connection-1' } as unknown as BitbucketAccount
    app = new Hono<AppEnv>()
      .use('/api/*', ...testGate({ kind: 'device', deviceId: 'device', userId: 'owner' }))
      .route('/api/import', bitbucketImport(plugin.db, core, account))
  })

  afterEach(() => plugin.cleanup())

  const clone = async (folder: string) => {
    const response = await app.fetch(
      new Request('http://acorn.test/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositories: [{ repository: 'acme/api', action: 'clone', parentDir: folder }] }),
      }),
      {} as Env,
    )
    return ((await response.json()) as { results: { ok: boolean; error?: string }[] }).results[0]
  }

  it('clones into a folder that exists', async () => {
    expect(await clone(parentDir)).toMatchObject({ ok: true })
    expect(gitOrThrow).toHaveBeenCalledWith(['clone', '--', 'https://bitbucket.org/acme/api.git', 'api'], {
      cwd: parentDir,
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
  })

  // A typed folder from a remote Node can name nothing; git would report that as a missing git.
  it('fails a clone into a folder that does not exist before running git', async () => {
    expect(await clone(join(parentDir, 'acorn-no-such-folder'))).toEqual({
      repository: 'acme/api',
      action: 'clone',
      ok: false,
      error: "That folder doesn't exist on this Node.",
    })
    expect(gitOrThrow).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
