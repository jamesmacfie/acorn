// The one thing this file guards: a committed `.acorn/config.toml [database].url_script` is a shell
// script from the checkout, so resolving the Database pane's connection must not run it until the repo
// config has been reviewed (core/main/repoConfigTrust.ts). Cloning a repo — or checking out a PR that
// adds the file — must not be sufficient to execute its commands.
//
// Only the refusal direction is tested here, deliberately: letting the script actually run means
// spawning `bash -lc`, a login shell that sources the user's profile and costs ~15s under the full
// parallel suite. The "does not over-block" direction is already covered without that cost —
// runConfig.test.ts pins dbUrlFromRepo to false for user/DB-authored scripts (so the gate is never
// reached), and repoConfigTrust.test.ts pins assertRepoConfigTrusted to resolve once acknowledged.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import * as coreFs from '@acorn/node-core/main/core/fs.ts'
import { createRepoService } from '@acorn/node-core/main/core/repos.ts'
import { createTaskService } from '@acorn/node-core/main/core/tasks.ts'
import { RepoConfigTrustError } from '@acorn/node-core/main/repoConfigTrust.ts'
import { resolveDbUrl, type DatabaseCoreServices } from './database'

describe('resolveDbUrl: repo-authored url_script trust gate', () => {
  let testDb: TestDb
  let dir: string
  let repo: string
  let marker: string
  // The plugin holds no handle to core's database: it resolves the task, the repo row and the trust
  // gate through CoreServices, so that is what the subject under test is given.
  let core: DatabaseCoreServices

  // The script's only job is to prove it ran. `existsSync(marker)` is therefore an exact "did the
  // untrusted script execute?" oracle — stronger than asserting on an error string.
  const writeCommittedUrlScript = () =>
    writeFileSync(join(repo, '.acorn', 'config.toml'), `[database]\nurl_script = "touch ${marker}; echo postgres://from-script/db"\n`)

  beforeEach(async () => {
    testDb = makeTestDb()
    core = { tasks: createTaskService(testDb.db), repos: createRepoService(testDb.db), fs: coreFs }
    dir = mkdtempSync(join(tmpdir(), 'acorn-db-trust-'))
    repo = join(dir, 'repo')
    marker = join(dir, 'EXECUTED')
    mkdirSync(join(repo, '.acorn'), { recursive: true })
    const now = Date.now()
    await testDb.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'widget', path: repo, createdAt: now, updatedAt: now })
    // worktreePath === the checkout, so taskRoot resolves without any git work.
    await testDb.db.insert(schema.tasks).values({
      id: 'task1', title: 'Task', origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'main',
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
    // The gate sits OUTSIDE the try/catch that treats a failing script as "auto-detect instead". If it
    // ever moves inside, an untrusted repo silently downgrades to this .env URL and the refusal
    // becomes invisible — so assert the throw wins over a perfectly usable fallback.
    writeCommittedUrlScript()
    writeFileSync(join(repo, '.env'), 'DATABASE_URL=postgres://from-dotenv/db\n')
    await expect(resolveDbUrl(core, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)
    expect(existsSync(marker)).toBe(false)
  })
})
