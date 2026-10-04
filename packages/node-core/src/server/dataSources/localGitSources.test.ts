import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readDataPointer } from '@acorn/protocol/dataValues.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { invokeDataSource } from './runtime'
import { parseLocalWorktrees } from './localGitSources'
import './localGitRegistration'

const worlds: TestDb[] = []
const paths: string[] = []
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
const git = (path: string, ...args: string[]) => execFileSync('git', args, { cwd: path, encoding: 'utf8' }).trim()

describe('local Git worktree roster', () => {
  it('keeps managed and unmanaged trees and detached heads', () => {
    const roster = [
      'worktree /repo', 'HEAD abc', 'branch refs/heads/main', '',
      'worktree /unmanaged', 'HEAD def', 'branch refs/heads/topic', '',
      'worktree /detached', 'HEAD fed', 'detached', '',
    ].join('\0')
    expect(parseLocalWorktrees(roster)).toEqual([
      { path: '/repo', branch: 'main', head: 'abc' },
      { path: '/unmanaged', branch: 'topic', head: 'def' },
      { path: '/detached', branch: null, head: 'fed' },
    ])
  })
})

it('reads a tracked fork repository while untracked branches use origin', async () => {
  const world = makeTestDb()
  worlds.push(world)
  const path = mkdtempSync(join(tmpdir(), 'acorn-branch-remote-'))
  paths.push(path)
  git(path, 'init', '-b', 'main')
  git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'seed')
  git(path, 'branch', 'feature')
  git(path, 'remote', 'add', 'origin', 'https://github.com/Org/Base.git')
  git(path, 'remote', 'add', 'fork', 'git@github.com:Fork/Widget.git')
  git(path, 'update-ref', 'refs/remotes/fork/feature', git(path, 'rev-parse', 'HEAD'))
  git(path, 'branch', '--set-upstream-to=fork/feature', 'feature')
  const now = Date.now()
  await world.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await world.db.insert(schema.projects).values({ id: 'project', name: 'Base', path, workspaceId: 'ws', sort: 0,
    hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/Org/Base.git',
    githubOwner: 'org', githubName: 'base', githubRepoId: null, createdAt: now, updatedAt: now })
  const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner') })
  const page = await invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: now, pageSize: 25,
    query: { source: { pluginId: 'core', sourceId: 'local-branches' }, scope: { workspaceId: 'ws', projectId: 'project', parameters: {} }, sort: [] } },
  { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, signal: new AbortController().signal })
  expect(page.records.map(record => ({ branch: readDataPointer(record.data, '/name'),
    repository: readDataPointer(record.data, '/githubRepository') }))).toEqual(expect.arrayContaining([
    { branch: 'feature', repository: 'fork/widget' }, { branch: 'main', repository: 'org/base' },
  ]))
  expect(page.records).toHaveLength(2)
})
