// URL resolution is a privileged core boundary: committed executable configuration must not run
// until the repository trust acknowledgement covers it.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import * as coreFs from './fs'
import { createProjectService } from './projectRefs'
import * as coreProc from './proc'
import { createTaskService } from './tasks'
import { RepoConfigTrustError } from '../repoConfigTrust'
import { dataReadOnlyRefusal, resolveTaskDataUrl } from './data'

describe('dataReadOnlyRefusal', () => {
  it('accepts reads and refuses multiple-statement and CTE writes', () => {
    expect(dataReadOnlyRefusal('select 1')).toBeNull()
    expect(dataReadOnlyRefusal('-- a note\n with x as (select 1) select * from x')).toBeNull()
    expect(dataReadOnlyRefusal('delete from orders')).toContain('writes')
    expect(dataReadOnlyRefusal('select 1; drop table orders')).toContain('writes')
    expect(dataReadOnlyRefusal('with gone as (delete from orders returning id) select * from gone')).toContain('writes')
  })
})

describe('resolveTaskDataUrl: repo-authored url_script trust gate', () => {
  let testDb: TestDb
  let dir: string
  let repo: string
  let marker: string
  let core: Parameters<typeof resolveTaskDataUrl>[0]

  const writeCommittedUrlScript = () =>
    writeFileSync(join(repo, '.acorn', 'config.toml'), `[database]\nurl_script = "touch ${marker}; echo postgres://from-script/db"\n`)

  beforeEach(async () => {
    testDb = makeTestDb()
    core = { tasks: createTaskService(testDb.db), projects: createProjectService(testDb.db), fs: coreFs, proc: coreProc }
    dir = mkdtempSync(join(tmpdir(), 'acorn-data-trust-'))
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
    await expect(resolveTaskDataUrl(core, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)
    expect(existsSync(marker)).toBe(false)
  })

  it('fails closed rather than falling through to the .env fallback', async () => {
    writeCommittedUrlScript()
    writeFileSync(join(repo, '.env'), 'DATABASE_URL=postgres://from-dotenv/db\n')
    await expect(resolveTaskDataUrl(core, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)
    expect(existsSync(marker)).toBe(false)
  })
})
