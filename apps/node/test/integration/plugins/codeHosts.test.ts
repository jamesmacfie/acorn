import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Project } from '@acorn/protocol/api.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
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

  // A folder holding a Git checkout whose origin is `remote`, added over the projects route.
  const addProject = async (name: string, remote: string): Promise<Project> => {
    const path = join(dataRoot, 'checkouts', name)
    mkdirSync(path, { recursive: true })
    execFileSync('git', ['init'], { cwd: path, stdio: 'pipe' })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: path, stdio: 'pipe' })
    const response = await createApp().fetch(
      new Request('http://127.0.0.1/v1/core/projects', {
        method: 'POST',
        headers: { authorization: 'Bearer paired-device-token', 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
      env,
    )
    expect(response.status).toBe(200)
    return ((await response.json()) as { project: Project }).project
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
      running = await initPlugins([loaded.plugin], {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({
          db: core.db,
          secrets: core.secrets,
          activeIdentity: memoryIdentityStore('james'),
          ...testCoreSeams(),
        }),
        dataDir: dataRoot,
        env,
        loaded: new Map([[loaded.manifest.id, loadedPluginBinding(loaded)]]),
      })
    } finally {
      error.mockRestore()
    }
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

  it('stops naming the host once the plugin stops', async () => {
    await running?.dispose()
    running = null
    const project = await addProject('after', 'git@gitlab.test:group/api.git')
    expect(project.repository?.provider).toBeNull()
  }, 20_000)
})
