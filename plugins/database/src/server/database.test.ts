// The one thing this file guards: a committed `.acorn/config.toml [database].url_script` is a shell
// script from the checkout, so resolving the Database pane's connection must not run it until the repo
// config has been reviewed (core/server/repoConfigTrust.ts; docs/data-layer.md § Database plugin: the
// Postgres pane). Cloning a repo, or checking out a PR that adds the file, must not be enough to
// execute its commands.
//
// Only the refusal direction is tested here. Letting the script run means spawning `bash -lc`, a login
// shell that sources the user's profile and costs about 15 seconds under the full parallel suite. The
// "does not over-block" direction is covered elsewhere: runConfig.test.ts pins dbUrlFromRepo to false
// for user- and DB-authored scripts, and repoConfigTrust.test.ts pins assertRepoConfigTrusted to
// resolve once acknowledged.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, schema, type TestDb } from '@acorn/plugin-api/testkit'
import * as coreFs from '@acorn/node-core/server/core/fs.ts'
import { createProjectService } from '@acorn/node-core/server/core/projectRefs.ts'
import { createTaskService } from '@acorn/node-core/server/core/tasks.ts'
import { RepoConfigTrustError } from '@acorn/node-core/server/repoConfigTrust.ts'
import { resolveDbUrl, type DatabaseCoreServices } from './database'

describe('resolveDbUrl: repo-authored url_script trust gate', () => {
  let testDb: TestDb
  let dir: string
  let repo: string
  let marker: string
  // The plugin holds no handle to core's database. It resolves the task, the repo row, and the trust
  // gate through CoreServices, so that is what the subject under test is given.
  let core: DatabaseCoreServices

  // The script's only job is to prove it ran, so `existsSync(marker)` answers "did the untrusted
  // script execute?" exactly, which beats asserting on an error string.
  const writeCommittedUrlScript = () =>
    writeFileSync(join(repo, '.acorn', 'config.toml'), `[database]\nurl_script = "touch ${marker}; echo postgres://from-script/db"\n`)

  beforeEach(async () => {
    testDb = makeTestDb()
    core = { tasks: createTaskService(testDb.db), projects: createProjectService(testDb.db), fs: coreFs }
    dir = mkdtempSync(join(tmpdir(), 'acorn-db-trust-'))
    repo = join(dir, 'repo')
    marker = join(dir, 'EXECUTED')
    mkdirSync(join(repo, '.acorn'), { recursive: true })
    const now = Date.now()
    await testDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await testDb.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: repo, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    // worktreePath === the checkout, so taskRoot resolves without any git work.
    await testDb.db.insert(schema.tasks).values({
      id: 'task1', title: 'Task', origin: 'local', projectId: 'project-widget', branch: 'main',
      worktreePath: repo, pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to run an unreviewed committed url_script', async () => {
    writeCommittedUrlScript()
    await expect(resolveDbUrl(core, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)
    expect(existsSync(marker)).toBe(false)
  })

  it('fails closed rather than falling through to the .env fallback', async () => {
    // The gate sits outside the try/catch that treats a failing script as "auto-detect instead". Move
    // it inside and an untrusted repo quietly downgrades to the .env URL, so this asserts the throw
    // wins over a usable fallback.
    writeCommittedUrlScript()
    writeFileSync(join(repo, '.env'), 'DATABASE_URL=postgres://from-dotenv/db\n')
    await expect(resolveDbUrl(core, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)
    expect(existsSync(marker)).toBe(false)
  })
})
