import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { testSecretEnv, makeTestPluginDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { testGate } from '@acorn/node-core/testkit/auth.ts'
import type { ProjectRef } from '@acorn/node-core/main/core/index.ts'
import { repos } from '../../node/schema'
import { migrationsDir } from '../../node/migrations'
import { githubImport } from './import'

const principal = { kind: 'device' as const, deviceId: 'device', userId: 'james' }
const ref = (id: string, github: ProjectRef['github'] = null): ProjectRef => ({ id, name: id, path: null, workspaceId: 'default', github })

describe('GitHub project importer', () => {
  let plugin: TestPluginDb
  let app: Hono<AppEnv>
  const create = vi.fn()
  const update = vi.fn()
  const gitOrThrow = vi.fn()

  beforeEach(async () => {
    plugin = makeTestPluginDb('github', migrationsDir())
    await plugin.db.insert(repos).values([
      { userId: 'james', id: 101, owner: 'acme', name: 'map-me', private: false, defaultBranch: 'main', pushedAt: null, fetchedAt: Date.now() },
      { userId: 'james', id: 102, owner: 'acme', name: 'clone-me', private: false, defaultBranch: 'main', pushedAt: null, fetchedAt: Date.now() },
      { userId: 'james', id: 103, owner: 'acme', name: 'defer-me', private: true, defaultBranch: 'trunk', pushedAt: null, fetchedAt: Date.now() },
    ])
    create.mockReset()
    update.mockReset()
    gitOrThrow.mockReset()
    create.mockImplementation(async ({ name, path, github }: { name: string; path: string | null; github?: ProjectRef['github'] }) => ref(`${name}-${path ?? 'deferred'}`, github ?? null))
    update.mockImplementation(async (id: string) => ref(id))
    gitOrThrow.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const core = { projects: { create, update }, git: { gitOrThrow } } as never
    app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api', githubImport(plugin.db, core))
  })

  afterEach(() => plugin.cleanup())

  const env = () => ({ ...testSecretEnv('0'.repeat(64)) }) as unknown as Env
  const post = (body: unknown) => app.fetch(new Request('http://acorn.test/api/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env())

  it('maps and defers through CoreServices with per-repository results', async () => {
    const response = await post({ repositories: [
      { repoId: 101, action: 'map', path: '/checkouts/map-me' },
      { repoId: 103, action: 'defer' },
    ] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [
      { repoId: 101, owner: 'acme', name: 'map-me', action: 'map', ok: true, projectId: 'map-me-/checkouts/map-me' },
      { repoId: 103, owner: 'acme', name: 'defer-me', action: 'defer', ok: true, projectId: 'defer-me-deferred' },
    ] })
    expect(create).toHaveBeenNthCalledWith(1, { name: 'map-me', path: '/checkouts/map-me' })
    expect(update).toHaveBeenNthCalledWith(1, 'map-me-/checkouts/map-me', { githubRepoId: 101 })
    expect(create).toHaveBeenNthCalledWith(2, { name: 'defer-me', path: null, github: { owner: 'acme', name: 'defer-me', repoId: 103 } })
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
    expect(update).toHaveBeenCalledWith(expect.any(String), { githubRepoId: 102 })
  })

  it('fails a clone without prompting and continues returning a repository result', async () => {
    gitOrThrow.mockRejectedValueOnce(new Error('authentication required'))
    const response = await post({ repositories: [
      { repoId: 102, action: 'clone', parentDir: '/checkouts' },
      { repoId: 103, action: 'defer' },
    ] })
    const body = await response.json()
    expect(body.results).toEqual([
      { repoId: 102, owner: 'acme', name: 'clone-me', action: 'clone', ok: false, error: 'authentication required' },
      { repoId: 103, owner: 'acme', name: 'defer-me', action: 'defer', ok: true, projectId: 'defer-me-deferred' },
    ])
  })

  it('validates the mutation boundary and rejects unknown mirror candidates', async () => {
    expect((await post({ repositories: [{ repoId: '101', action: 'defer' }] })).status).toBe(400)
    const response = await post({ repositories: [{ repoId: 999, action: 'defer' }] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [{ repoId: 999, owner: '', name: '', action: 'defer', ok: false, error: 'Repository is not available in the GitHub mirror.' }] })
  })
})
