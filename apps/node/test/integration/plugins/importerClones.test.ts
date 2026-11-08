import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cloneOutcome } from '@acorn/protocol/api.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { declareCodeHost } from '@acorn/node-core/server/pluginHost'
import type { Env } from '@acorn/node-core/server/bindings.ts'
import { makeTestDb, makeTestPluginDb, testCoreSeams, testGate, type TestPluginDb } from '@acorn/node-core/testkit'
import { githubImport, repos } from '@acorn/plugin-github/testkit'
import { gitlabImport, projects as gitlabProjects } from '@acorn/plugin-gitlab/testkit'
import { bitbucketImport, repositories } from '@acorn/plugin-bitbucket/testkit'

// The importers build https addresses. Git's `insteadOf` sends each host to a local bare repository,
// and that only works with the `file` protocol, which production never allows.
vi.mock('@acorn/protocol/api.ts', async (original) => ({
  ...(await original<typeof import('@acorn/protocol/api.ts')>()),
  CLONE_PROTOCOLS: ['https', 'ssh', 'file'],
}))

// Each importer hands its clone to core's clone runs (docs/workspaces-and-tasks/clone-runs.md), which
// fills a path-less project for the repository or adds a row, and links it to the provider.
describe('importer clones', () => {
  const root = mkdtempSync(join(tmpdir(), 'acorn-importer-clones-'))
  const hosted = join(root, 'hosted')
  const core = makeTestDb()
  const services = createCoreServices({
    db: core.db,
    secrets: core.secrets,
    activeIdentity: memoryIdentityStore('james'),
    ...testCoreSeams(),
  })
  const pluginDbs: TestPluginDb[] = []
  const undeclare: Array<() => void> = []
  const gitConfig = { GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT }
  let app: Hono<AppEnv>

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=T', ...args], { cwd, stdio: 'pipe' })

  beforeAll(async () => {
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    git(source, 'init', '-q', '-b', 'main')
    git(source, 'commit', '-q', '--allow-empty', '-m', 'base')
    for (const repository of ['github.com/acme/app', 'gitlab.test/group/app', 'bitbucket.org/team/app'])
      git(root, 'clone', '-q', '--bare', source, join(hosted, `${repository}.git`))
    // Passed on to git through the Node's `GIT_*` allowlist.
    Object.assign(process.env, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${hosted}/.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://',
    })

    undeclare.push(
      declareCodeHost('github', { label: 'GitHub', hosts: ['github.com'] }, false),
      declareCodeHost('gitlab', { label: 'GitLab', hosts: ['gitlab.test'] }, false),
      declareCodeHost('bitbucket', { label: 'Bitbucket', hosts: ['bitbucket.org'] }, false),
    )
    const [github, gitlab, bitbucket] = ['github', 'gitlab', 'bitbucket'].map((plugin) => makeTestPluginDb(plugin))
    pluginDbs.push(github!, gitlab!, bitbucket!)
    const fetchedAt = Date.now()
    await github!.db.insert(repos).values({
      userId: 'james',
      id: 501,
      owner: 'acme',
      name: 'app',
      private: false,
      defaultBranch: 'main',
      fetchedAt,
    })
    await gitlab!.db
      .insert(gitlabProjects)
      .values({ connectionId: 'c1', id: 601, path: 'group/app', name: 'App', fetchedAt })
    await bitbucket!.db
      .insert(repositories)
      .values({ connectionId: 'c1', repo: 'team/app', path: 'team/app', name: 'App', fetchedAt })

    const servers = {
      byHost: (host: string) =>
        host === 'gitlab.test' ? { connectionId: 'c1', origin: 'https://gitlab.test', host } : null,
    }
    app = new Hono<AppEnv>()
      .use('/api/*', ...testGate({ kind: 'device', deviceId: 'device', userId: 'james' }))
      .route('/api/github', githubImport(github!.db, services))
      .route('/api/gitlab', gitlabImport(gitlab!.db, services, servers as never))
      .route('/api/bitbucket', bitbucketImport(bitbucket!.db, services, { connectionId: () => 'c1' } as never))
  })

  afterAll(async () => {
    await services.projects.stopClones()
    for (const dispose of undeclare) dispose()
    for (const db of pluginDbs) db.cleanup()
    core.cleanup()
    for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) delete process.env[key]
    if (gitConfig.GIT_CONFIG_COUNT !== undefined) process.env.GIT_CONFIG_COUNT = gitConfig.GIT_CONFIG_COUNT
    rmSync(root, { recursive: true, force: true })
  })

  const importers = [
    {
      provider: 'github',
      route: '/api/github/import',
      body: (parentDir: string) => ({ repositories: [{ repoId: 501, action: 'clone', parentDir }] }),
      placeholder: { name: 'app', github: { owner: 'acme', name: 'app' } },
      repository: { host: 'github.com', path: 'acme/app', externalId: '501' },
    },
    {
      provider: 'gitlab',
      route: '/api/gitlab',
      body: (parentDir: string) => ({
        projects: [{ host: 'gitlab.test', projectId: 601, action: 'clone', parentDir }],
      }),
      placeholder: { name: 'App', repository: { host: 'gitlab.test', path: 'group/app' } },
      repository: { host: 'gitlab.test', path: 'group/app', externalId: '601' },
    },
    {
      provider: 'bitbucket',
      route: '/api/bitbucket',
      body: (parentDir: string) => ({ repositories: [{ repository: 'team/app', action: 'clone', parentDir }] }),
      placeholder: { name: 'App', repository: { host: 'bitbucket.org', path: 'team/app' } },
      repository: { host: 'bitbucket.org', path: 'team/app', externalId: null },
    },
  ]

  // Answers once the clone run has finished.
  const importInto = async (importer: (typeof importers)[number], parentDir: string) => {
    mkdirSync(parentDir, { recursive: true })
    const response = await app.fetch(
      new Request(`http://acorn.test${importer.route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(importer.body(parentDir)),
      }),
      {} as Env,
    )
    const [result] = ((await response.json()) as { results: Array<{ ok: boolean; cloneId?: string; error?: string }> })
      .results
    expect(result).toMatchObject({ ok: true, cloneId: expect.any(String) })
    const outcome = await cloneOutcome(() => services.projects.cloneRun(result!.cloneId!, 20_000))
    if (!outcome.ok) throw new Error(outcome.error)
    return (await services.projects.byId(outcome.projectId))!
  }

  it.each(importers)(
    '$provider fills a path-less project and links it, then adds a second checkout as its own row',
    async (importer) => {
      const placeholder = await services.projects.create(importer.placeholder)
      const filled = await importInto(importer, join(root, importer.provider, 'first'))
      expect(filled).toMatchObject({
        id: placeholder.id,
        path: join(root, importer.provider, 'first', 'app'),
        repository: { provider: importer.provider, ...importer.repository },
      })
      expect(filled.trusted).not.toBe(false)

      // The placeholder has its folder now, so this clone gets a row of its own. Its repository isn't
      // checked: `git remote get-url` reads through the `insteadOf` above and names the local file.
      const added = await importInto(importer, join(root, importer.provider, 'second'))
      expect(added.id).not.toBe(placeholder.id)
      expect(added.path).toBe(join(root, importer.provider, 'second', 'app'))
    },
    30_000,
  )
})
