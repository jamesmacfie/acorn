import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Project, Task } from '@acorn/protocol/api.ts'
import { setWorktreesRoot } from '@acorn/node-core/server/worktrees'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { declareCodeHost } from '@acorn/node-core/server/pluginHost'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { loadExternalPlugins, loadedPluginBinding, pluginDir } from '@acorn/node-core/server/plugins'
import { makeTestDb, testEnv, type TestDb, testCoreSeams } from '@acorn/node-core/testkit'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// A third-party code host, installed the way a person installs a folder: its manifest claims
// gitlab.test, and nothing in core names it (docs/plugins/code-hosts.md).
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../__fixtures__/gitlab-test')

describe('a loaded code host', () => {
  let dataRoot = ''
  let core: TestDb
  let env: Env
  let running: Awaited<ReturnType<typeof initPlugins>> | null = null
  let services: ReturnType<typeof createCoreServices>

  const post = (path: string, body: unknown) =>
    createApp().fetch(
      new Request(`http://127.0.0.1${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer paired-device-token', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    )

  const postProject = async (path: string): Promise<Project> => {
    const response = await post('/v1/core/projects', { path })
    expect(response.status).toBe(200)
    return ((await response.json()) as { project: Project }).project
  }

  // A folder holding a Git checkout whose origin is `remote`, added over the projects route.
  const addProject = async (name: string, remote: string): Promise<Project> => {
    const path = join(dataRoot, 'checkouts', name)
    mkdirSync(path, { recursive: true })
    execFileSync('git', ['init'], { cwd: path, stdio: 'pipe' })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: path, stdio: 'pipe' })
    return postProject(path)
  }

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=T', ...args], { cwd, stdio: 'pipe' })
      .toString()
      .trim()

  // A clone of a local repository that names `remote` as its origin, so the project lands on that
  // remote's host while every fetch reaches the local one. Returns the project and the commit the local
  // repository serves at `refs/merge-requests/12/head` and on the branch `feat/source`.
  const cloneProject = async (name: string, remote: string): Promise<{ project: Project; head: string }> => {
    const upstream = join(dataRoot, 'upstream', name)
    mkdirSync(upstream, { recursive: true })
    git(upstream, 'init', '-q', '-b', 'main')
    git(upstream, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(upstream, 'commit', '-q', '--allow-empty', '-m', 'change request')
    const head = git(upstream, 'rev-parse', 'HEAD')
    git(upstream, 'reset', '-q', '--hard', 'HEAD~1')
    git(upstream, 'update-ref', 'refs/merge-requests/12/head', head)
    git(upstream, 'update-ref', 'refs/heads/feat/source', head)
    const path = join(dataRoot, 'checkouts', name)
    git(dataRoot, 'clone', '-q', upstream, path)
    git(path, 'remote', 'set-url', 'origin', remote)
    const project = await postProject(path)
    // After the project is added, because `git remote get-url` reads through it.
    git(path, 'config', `url.${upstream}.insteadOf`, remote)
    return { project, head }
  }

  const createTask = async (seed: Record<string, unknown>): Promise<Task> => {
    const response = await post('/v1/core/tasks', { origin: 'local', ...seed })
    expect(response.status).toBe(200)
    return (await response.json()) as Task
  }

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'acorn-code-hosts-'))
    cpSync(FIXTURE, pluginDir(dataRoot, 'gitlab-test'), { recursive: true })
    core = makeTestDb()
    env = testEnv({
      DB: core.db,
      DATA_DIR: dataRoot,
      ACTIVE_IDENTITY: { get: () => 'james', set: () => {}, clear: () => {} },
      DEVICES: {
        authenticate: async (candidate: string) =>
          candidate === 'paired-device-token' ? { deviceId: 'device-1' } : null,
      } as Env['DEVICES'],
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await loadExternalPlugins(dataRoot, { builtins: [] })
      expect(result.failures).toEqual([])
      const loaded = result.loaded[0]!
      services = createCoreServices({
        db: core.db,
        secrets: core.secrets,
        activeIdentity: memoryIdentityStore('james'),
        ...testCoreSeams(),
      })
      running = await initPlugins([loaded.plugin], {
        capabilities: new CapabilityRegistry(),
        core: services,
        dataDir: dataRoot,
        env,
        loaded: new Map([[loaded.manifest.id, loadedPluginBinding(loaded)]]),
      })
    } finally {
      error.mockRestore()
    }
    setWorktreesRoot(join(dataRoot, 'worktrees'))
  })

  afterAll(async () => {
    await running?.dispose()
    core.cleanup()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('names a project on its host, with a nested path', async () => {
    const project = await addProject('api', 'git@gitlab.test:group/subgroup/api.git')
    expect(project).toMatchObject({
      name: 'api',
      repository: { provider: 'gitlab-test', host: 'gitlab.test', path: 'group/subgroup/api', externalId: null },
      github: null,
    })
  }, 20_000)

  it('leaves a host nobody claims with a host and path and no provider', async () => {
    const project = await addProject('other', 'https://git.example.org/team/tool.git')
    expect(project.repository).toEqual({ provider: null, host: 'git.example.org', path: 'team/tool', externalId: null })
  }, 20_000)

  // Its change requests, with no core file naming the host (docs/plugins/code-hosts.md § Change requests).
  it('titles, checks out, and points the pane at a merge request', async () => {
    const { project, head } = await cloneProject('mr', 'git@gitlab.test:group/subgroup/mr.git')
    const task = await createTask({ projectId: project.id, branch: 'mr-12', changeRequest: { number: 12 } })
    expect(task).toMatchObject({
      title: '!12 mr',
      pullNumber: null,
      changeRequest: { provider: 'gitlab-test', number: 12, pane: 'gitlab-test-mr' },
    })
    const root = await services.tasks.root(task.id)
    expect(git(root!, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(root!, 'branch', '--show-current')).toBe('mr-12')
  }, 30_000)

  it('checks out the source branch on a host that declares no ref', async () => {
    const { project, head } = await cloneProject('plain', 'https://git.example.org/team/plain.git')
    const task = await createTask({
      projectId: project.id,
      branch: 'feat/source',
      changeRequest: { number: 3, sourceBranch: 'feat/source' },
    })
    expect(task).toMatchObject({ title: '#3 plain', changeRequest: { provider: null, number: 3 } })
    expect(git(project.path!, 'branch', '--list', 'feat/source')).toBe('')
    expect(git((await services.tasks.root(task.id))!, 'rev-parse', 'HEAD')).toBe(head)
  }, 30_000)

  // A fork's change request on a host that serves no change request ref, as Bitbucket Cloud does. Both
  // repositories sit in one folder that `insteadOf` maps the host to, so the fork's address, derived
  // from origin's, reaches the local fork over a file URL.
  it("checks out a fork's branch on a host that declares no ref", async () => {
    const undeclare = declareCodeHost('bitbucket-test', { label: 'Bitbucket test', hosts: ['bitbucket.test'] }, false)
    try {
      const hosted = join(dataRoot, 'bitbucket.test')
      const upstream = join(hosted, 'acme', 'api.git')
      const fork = join(hosted, 'alice', 'api.git')
      mkdirSync(upstream, { recursive: true })
      git(upstream, 'init', '-q', '-b', 'main')
      git(upstream, 'commit', '-q', '--allow-empty', '-m', 'base')
      git(dataRoot, 'clone', '-q', upstream, fork)
      git(fork, 'switch', '-q', '-c', 'fix')
      git(fork, 'commit', '-q', '--allow-empty', '-m', 'fork change')
      const head = git(fork, 'rev-parse', 'HEAD')
      const path = join(dataRoot, 'checkouts', 'forked')
      git(dataRoot, 'clone', '-q', upstream, path)
      git(path, 'remote', 'set-url', 'origin', 'https://bitbucket.test/acme/api.git')
      const project = await postProject(path)
      expect(project.repository).toMatchObject({ provider: 'bitbucket-test', path: 'acme/api' })
      git(path, 'config', `url.file://${hosted}/.insteadOf`, 'https://bitbucket.test/')

      const task = await createTask({
        projectId: project.id,
        branch: 'fix',
        changeRequest: { number: 7, sourceBranch: 'fix', sourceRepository: 'Alice/API' },
      })
      const root = await services.tasks.root(task.id)
      expect(git(root!, 'rev-parse', 'HEAD')).toBe(head)
      expect(git(root!, 'branch', '--show-current')).toBe('fix')
      expect(await services.tasks.changeRequests(task.id)).toEqual([
        expect.objectContaining({ number: 7, sourceRepository: 'alice/api' }),
      ])

      const refused = await post('/v1/core/tasks', {
        origin: 'local',
        projectId: project.id,
        changeRequest: { number: 8, sourceRepository: 'alice/..' },
      })
      expect(refused.status).toBe(400)
    } finally {
      undeclare()
    }
  }, 30_000)

  it('ignores a source repository on a host that declares a ref', async () => {
    const { project, head } = await cloneProject('mr-fork', 'git@gitlab.test:group/mr-fork.git')
    const task = await createTask({
      projectId: project.id,
      branch: 'mr-fork-12',
      changeRequest: { number: 12, sourceRepository: 'alice/mr-fork' },
    })
    expect(git((await services.tasks.root(task.id))!, 'rev-parse', 'HEAD')).toBe(head)
  }, 30_000)

  it('stops naming the host once the plugin stops', async () => {
    await running?.dispose()
    running = null
    const project = await addProject('after', 'git@gitlab.test:group/api.git')
    expect(project.repository?.provider).toBeNull()
  }, 20_000)
})
