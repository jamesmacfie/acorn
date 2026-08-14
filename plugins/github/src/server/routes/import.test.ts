import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { testSecretEnv, makeTestPluginDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { testGate } from '@acorn/node-core/testkit/auth.ts'
import type { ProjectRef } from '@acorn/node-core/main/core/index.ts'
import { repos } from '../../node/schema'
import { githubImport } from './import'

const principal = { kind: 'device' as const, deviceId: 'device', userId: 'james' }
const ref = (id: string, path: string | null = null, github: ProjectRef['github'] = null): ProjectRef =>
  ({ id, name: id, path, workspaceId: 'default', github })

describe('GitHub project importer', () => {
  let plugin: TestPluginDb
  let app: Hono<AppEnv>
  const create = vi.fn()
  const update = vi.fn()
  const byGithub = vi.fn()
  const gitOrThrow = vi.fn()

  beforeEach(async () => {
    plugin = makeTestPluginDb('github')
    await plugin.db.insert(repos).values([
      { userId: 'james', id: 101, owner: 'acme', name: 'map-me', private: false, defaultBranch: 'main', pushedAt: null, fetchedAt: Date.now() },
      { userId: 'james', id: 102, owner: 'acme', name: 'clone-me', private: false, defaultBranch: 'main', pushedAt: null, fetchedAt: Date.now() },
      { userId: 'james', id: 103, owner: 'acme', name: 'placeholder-me', private: true, defaultBranch: 'trunk', pushedAt: null, fetchedAt: Date.now() },
    ])
    create.mockReset()
    update.mockReset()
    byGithub.mockReset()
    gitOrThrow.mockReset()
    create.mockImplementation(async ({ name, path }: { name: string; path: string }) => ref(`${name}-${path}`, path))
    update.mockImplementation(async (id: string, patch: { path?: string }) => ref(id, patch.path ?? null))
    byGithub.mockResolvedValue(null)
    gitOrThrow.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const core = { projects: { create, update, byGithub }, git: { gitOrThrow } } as never
    app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api', githubImport(plugin.db, core))
  })

  afterEach(() => plugin.cleanup())

  const env = () => ({ ...testSecretEnv('0'.repeat(64)) }) as unknown as Env
  const post = (body: unknown) => app.fetch(new Request('http://acorn.test/api/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env())

  it('maps a folder through CoreServices with per-repository results', async () => {
    const response = await post({ repositories: [{ repoId: 101, action: 'map', path: '/checkouts/map-me' }] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [
      { repoId: 101, owner: 'acme', name: 'map-me', action: 'map', ok: true, projectId: 'map-me-/checkouts/map-me' },
    ] })
    expect(create).toHaveBeenCalledWith({ name: 'map-me', path: '/checkouts/map-me' })
    expect(update).toHaveBeenCalledWith('map-me-/checkouts/map-me', { path: '/checkouts/map-me', githubRepoId: 101 })
  })

  it('clones through core.git with terminal prompts disabled and stamps the project', async () => {
    const response = await post({ repositories: [{ repoId: 102, action: 'clone', parentDir: '/checkouts' }] })
    expect(response.status).toBe(200)
    expect((await response.json()).results[0]).toMatchObject({ repoId: 102, action: 'clone', ok: true })
    expect(gitOrThrow).toHaveBeenCalledWith(
      ['clone', 'https://github.com/acme/clone-me.git', 'clone-me'],
      { cwd: '/checkouts', env: { GIT_TERMINAL_PROMPT: '0' } },
    )
    expect(create).toHaveBeenCalledWith({ name: 'clone-me', path: '/checkouts/clone-me' })
    expect(update).toHaveBeenCalledWith(expect.any(String), { path: '/checkouts/clone-me', githubRepoId: 102 })
  })

  // The duplicate this closes: an older import left a path-less placeholder for the repository, and
  // mapping a folder afterwards produced a SECOND project for the same repo.
  it('fills in a path-less project for the same repository instead of creating a rival', async () => {
    byGithub.mockResolvedValue(ref('placeholder-id', null))
    const response = await post({ repositories: [{ repoId: 103, action: 'map', path: '/checkouts/placeholder-me' }] })
    expect((await response.json()).results[0]).toMatchObject({ ok: true, projectId: 'placeholder-id' })
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('placeholder-id', { path: '/checkouts/placeholder-me', githubRepoId: 103 })
  })

  // Two clones of one repository are legal (schema.ts keeps projects_github_idx non-unique), so a
  // project that already has a path must not be repointed by the next import.
  it('creates a new project when the existing one is already a real checkout', async () => {
    byGithub.mockResolvedValue(ref('existing-id', '/elsewhere/map-me'))
    await post({ repositories: [{ repoId: 101, action: 'map', path: '/checkouts/map-me' }] })
    expect(create).toHaveBeenCalledWith({ name: 'map-me', path: '/checkouts/map-me' })
  })

  it('fails a clone without prompting and continues returning a repository result', async () => {
    gitOrThrow.mockRejectedValueOnce(new Error('authentication required'))
    const response = await post({ repositories: [
      { repoId: 102, action: 'clone', parentDir: '/checkouts' },
      { repoId: 101, action: 'map', path: '/checkouts/map-me' },
    ] })
    const body = await response.json()
    expect(body.results).toEqual([
      { repoId: 102, owner: 'acme', name: 'clone-me', action: 'clone', ok: false, error: 'authentication required' },
      { repoId: 101, owner: 'acme', name: 'map-me', action: 'map', ok: true, projectId: 'map-me-/checkouts/map-me' },
    ])
  })

  it('validates the mutation boundary and rejects unknown mirror candidates', async () => {
    expect((await post({ repositories: [{ repoId: '101', action: 'map', path: '/x' }] })).status).toBe(400)
    // 'defer' was removed from the contract: not importing is what deferring meant.
    expect((await post({ repositories: [{ repoId: 101, action: 'defer' }] })).status).toBe(400)
    const response = await post({ repositories: [{ repoId: 999, action: 'map', path: '/x' }] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [{ repoId: 999, owner: '', name: '', action: 'map', ok: false, error: 'Repository is not available in the GitHub mirror.' }] })
  })
})
