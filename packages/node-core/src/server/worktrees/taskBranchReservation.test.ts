import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { makeTestDb } from '../../testkit/db'
import { schema } from '../db'
import { getProject } from '../projects'
import { withBranchReservation } from './taskBranch'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = '' })

it('serializes a task branch reservation and a ref metadata write across aliases, while another repository proceeds', async () => {
  directory = mkdtempSync(join(tmpdir(), 'acorn-branch-lock-'))
  const shared = join(directory, 'shared'), other = join(directory, 'other')
  execFileSync('git', ['init', '-q', shared])
  execFileSync('git', ['init', '-q', other])
  const testDb = makeTestDb()
  try {
    const at = Date.now()
    await testDb.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
    for (const [id, path] of [['alias-a', shared], ['alias-b', shared], ['other', other]]) {
      await testDb.db.insert(schema.projects).values({ id, name: id, path, workspaceId: 'ws', sort: 0, hidden: false, vcs: 'git',
        defaultBranch: null, remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null, createdAt: at, updatedAt: at })
    }
    const a = (await getProject(testDb.db, 'alias-a'))!, b = (await getProject(testDb.db, 'alias-b'))!, independent = (await getProject(testDb.db, 'other'))!
    const held = deferred(), entered = deferred()
    const reservation = withBranchReservation(testDb.db, a, async () => { entered.resolve(); await held.promise; return 'reserved' })
    await entered.promise
    let metadataEntered = false
    const metadata = withBranchReservation(testDb.db, b, async () => { metadataEntered = true; return 'changed' })
    expect(await withBranchReservation(testDb.db, independent, async () => 'independent')).toBe('independent')
    expect(metadataEntered).toBe(false)
    held.resolve()
    expect(await reservation).toBe('reserved')
    expect(await metadata).toBe('changed')
    expect(metadataEntered).toBe(true)
  } finally { testDb.cleanup() }
})
