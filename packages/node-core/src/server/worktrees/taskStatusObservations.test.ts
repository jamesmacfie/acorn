import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { makeTestDb } from '../../testkit/db'
import { deleteProject } from '../projects'
import { broadcastHeadChanged } from '../notify'
import { computeTaskStatuses, setWorktreesRoot } from './taskWorktree'
import { worktreePorcelain } from './worktrees'
import { beginTaskArchive, finishTaskArchive } from './archiveGate'
import { retireTaskHead } from './taskHeadObserver'

vi.mock('./worktrees', async (original) => ({ ...await original<typeof import('./worktrees')>(), worktreePorcelain: vi.fn() }))
vi.mock('../notify', async (original) => ({ ...await original<typeof import('../notify')>(), broadcastHeadChanged: vi.fn() }))
const status = vi.mocked(worktreePorcelain)
const events = vi.mocked(broadcastHeadChanged)
const value = (head: string | null) => ({ dirty: false, count: 0, branch: 'feature', head })
let path: string
let rows: { id: string; projectId: string; worktreePath: string }[]
const db = { select: () => ({ from: () => ({ where: async () => rows.slice() }) }) } as unknown as AppDatabase
const heldStatus = () => {
  let resolve!: (v: ReturnType<typeof value>) => void
  const promise = new Promise<ReturnType<typeof value>>((r) => { resolve = r })
  status.mockReturnValueOnce(promise)
  return resolve
}

beforeEach(() => {
  path = mkdtempSync(join(tmpdir(), 'acorn-head-observations-'))
  setWorktreesRoot(path)
  rows = [{ id: 'task', projectId: 'project', worktreePath: path }]
  status.mockReset()
  events.mockClear()
})
afterEach(() => {
  finishTaskArchive('task')
  setWorktreesRoot('')
  rmSync(path, { recursive: true, force: true })
})

it('returns an obsolete caller its original status but publishes only the newest HEAD once', async () => {
  status.mockResolvedValueOnce(value('A'))
  await computeTaskStatuses(db)
  const release = heldStatus()
  const old = computeTaskStatuses(db)
  await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
  status.mockResolvedValue(value('B'))
  expect((await computeTaskStatuses(db))[0]?.head).toBe('B')
  release(value('A'))
  expect((await old)[0]?.head).toBe('A')
  await computeTaskStatuses(db)
  expect(events.mock.calls.map(([event]) => event.head)).toEqual(['B'])
})

it('authorizes before reads and lets disjoint authorized rosters publish independently', async () => {
  rows.push({ id: 'other', projectId: 'project', worktreePath: path })
  status.mockResolvedValue(value('A'))
  await computeTaskStatuses(db)
  status.mockClear()
  const release = heldStatus()
  const first = computeTaskStatuses(db, (id) => id === 'task')
  await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1))
  status.mockResolvedValue(value('B'))
  await computeTaskStatuses(db, (id) => id === 'other')
  release(value('B'))
  await first
  expect(status).toHaveBeenCalledTimes(2)
  expect(events.mock.calls.map(([event]) => event.taskId).sort()).toEqual(['other', 'task'])
})

it.each(['archive', 'task retirement', 'roster retirement', 'data-root reset'] as const)('cannot seed a held observation after %s', async (retirement) => {
  const release = heldStatus()
  const old = computeTaskStatuses(db)
  await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1))
  if (retirement === 'archive') beginTaskArchive('task')
  if (retirement === 'task retirement') retireTaskHead('task')
  if (retirement === 'data-root reset') setWorktreesRoot(path)
  if (retirement === 'roster retirement') {
    rows = []
    await computeTaskStatuses(db)
  }
  release(value('A'))
  await old
  finishTaskArchive('task')
  rows = [{ id: 'task', projectId: 'project', worktreePath: path }]
  status.mockResolvedValue(value('B'))
  await computeTaskStatuses(db)
  expect(events).not.toHaveBeenCalled()
})

it('project deletion retires a held observation even though the folder remains', async () => {
  const t = makeTestDb()
  try {
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace', name: 'Fixture', createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({ id: 'project', workspaceId: 'workspace', name: 'Fixture', path, createdAt: now, updatedAt: now })
    await t.db.insert(schema.tasks).values({ id: 'task', projectId: 'project', title: 'Fixture', origin: 'local', status: 'active', worktreePath: path, createdAt: now, updatedAt: now })
    const release = heldStatus()
    const old = computeTaskStatuses(t.db)
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1))
    await deleteProject(t.db, 'project')
    release(value('A'))
    await old
    status.mockResolvedValue(value('B'))
    // Reusing the identity must seed silently rather than inheriting the deleted task's HEAD.
    await computeTaskStatuses(db)
    expect(events).not.toHaveBeenCalled()
  } finally { t.cleanup() }
})

it('a roster held across a data-root reset cannot seed the replacement observer', async () => {
  let release!: (value: typeof rows) => void
  const held = new Promise<typeof rows>((r) => { release = r })
  const heldDb = { select: () => ({ from: () => ({ where: () => held }) }) } as unknown as AppDatabase
  const old = computeTaskStatuses(heldDb)
  setWorktreesRoot(path)
  status.mockResolvedValueOnce(value('A'))
  release(rows)
  expect((await old)[0]?.head).toBe('A')
  status.mockResolvedValueOnce(value('B'))
  await computeTaskStatuses(db)
  expect(events).not.toHaveBeenCalled()
})

it('preserves null status behavior and excludes archiving tasks before Git', async () => {
  status.mockResolvedValueOnce(value('A')).mockResolvedValueOnce(value(null)).mockResolvedValueOnce(value('B'))
  await computeTaskStatuses(db)
  expect((await computeTaskStatuses(db))[0]?.head).toBeNull()
  await computeTaskStatuses(db)
  expect(events.mock.calls.map(([event]) => event.head)).toEqual(['B'])
  beginTaskArchive('task')
  expect(await computeTaskStatuses(db)).toEqual([])
  expect(status).toHaveBeenCalledTimes(3)
})
