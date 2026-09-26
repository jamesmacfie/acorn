import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, patchBlobKey, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { filesResource, prResource } from '../../resourceKeys'
import { prFiles, reviewThreads, syncState } from '../../../node/schema'
import { refreshPullDetail, refreshPullFiles } from '../pulls/pullRefresh'
import { fakeGithub, makeFakePull } from './fakeGithub.helper'
import { filesCompleteness, mirrorFiles, patchDigest, readComposite, readFiles, type PatchBlobStore } from './prMirror'
import { COMPLETE } from './prFetch'

// The mirror half of phase 1, against the real migrated github.sqlite: a refresh either swaps in a
// complete, ordered resource with its sync row, or changes nothing at all.

const USER = 'ada'
const REPO_ID = 11
const key = { userId: USER, repoId: REPO_ID, number: 7 }
const refreshKey = { ...key, owner: 'acme', repo: 'web' }

let plugin: TestPluginDb
let blobs: Map<string, string>
let gets: string[]
let puts: string[]
const store: PatchBlobStore = {
  get: async (k) => {
    gets.push(k)
    return blobs.get(k) ?? null
  },
  put: async (k, v) => {
    puts.push(k)
    blobs.set(k, v)
  },
}

const fileRows = () => plugin.db.select().from(prFiles).where(eq(prFiles.number, 7)).orderBy(asc(prFiles.position))
const filesSync = async () => (await plugin.db.select().from(syncState).where(and(eq(syncState.userId, USER), eq(syncState.resource, filesResource(REPO_ID, 7)))))[0]

beforeEach(() => {
  plugin = makeTestPluginDb('github')
  blobs = new Map()
  gets = []
  puts = []
})
afterEach(() => {
  plugin.cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('files mirror', () => {
  it('swaps in all 2,200 files in provider order with their sync row', async () => {
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 2200 })).fetch)
    expect(await refreshPullFiles('token', plugin.db, store, refreshKey)).toEqual({ ok: true })

    const rows = await fileRows()
    expect(rows).toHaveLength(2200)
    expect(rows.map((r) => r.position)).toEqual(Array.from({ length: 2200 }, (_, i) => i))
    expect(rows[1234]).toMatchObject({ path: 'src/file-1234.ts', patchState: 'available' })
    const sync = await filesSync()
    expect(sync && filesCompleteness(sync)).toEqual(COMPLETE)

    const read = await readFiles(store, plugin.db, key, { includePatches: false })
    expect(read.ok && read.files.map((f) => f.path).slice(0, 3)).toEqual(['src/file-0.ts', 'src/file-1.ts', 'src/file-2.ts'])
  })

  it('leaves every old row, the sync time and completeness alone when page 12 fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000)
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 3500, changedFiles: 3500 })).fetch)
    expect(await refreshPullFiles('token', plugin.db, store, refreshKey)).toEqual({ ok: true })
    const before = await fileRows()
    const syncBefore = await filesSync()
    expect(syncBefore && filesCompleteness(syncBefore)).toMatchObject({ kind: 'incomplete', received: 3000, reportedTotal: 3500 })

    vi.setSystemTime(2_000)
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 2200 }), {
      override: (r) => (r.kind === 'files' && r.page === 12 ? new Response('unavailable', { status: 502 }) : undefined),
    }).fetch)
    expect(await refreshPullFiles('token', plugin.db, store, refreshKey)).toMatchObject({ ok: false })

    expect(await fileRows()).toEqual(before)
    expect(await filesSync()).toEqual(syncBefore)
  })

  it('replaces an incomplete resource with a complete one, clearing the stored cause', async () => {
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 3500, changedFiles: null })).fetch)
    await refreshPullFiles('token', plugin.db, store, refreshKey)
    const capped = await filesSync()
    expect(capped && filesCompleteness(capped)).toEqual({ kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: 3000, reportedTotal: null, limit: 3000 })

    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ files: 40 })).fetch)
    await refreshPullFiles('token', plugin.db, store, refreshKey)
    const sync = await filesSync()
    expect(sync).toMatchObject({ incompleteCause: null, received: null, reportedTotal: null, upstreamLimit: null })
    expect(await fileRows()).toHaveLength(40)
  })

  it('cuts an unchanged patch once, however often the pull refreshes', async () => {
    const fetched = { files: [{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1, sha: 'head', patch: '@@ -1 +1 @@\n-a\n+b' }], completeness: COMPLETE }
    await mirrorFiles(store, plugin.db, key, fetched)
    await mirrorFiles(store, plugin.db, key, fetched)
    expect(puts.filter((k) => k.startsWith('diffdoc:'))).toHaveLength(1)
  })

  it('keys two different patches of the same head blob apart', async () => {
    const fetched = (patch: string) => ({
      files: [{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1, sha: 'same-head-blob', patch }],
      completeness: COMPLETE,
    })
    await mirrorFiles(store, plugin.db, key, fetched('@@ -1 +1 @@\n-a\n+b'))
    await mirrorFiles(store, plugin.db, { ...key, number: 8 }, fetched('@@ -1 +1 @@\n-z\n+b'))

    const seven = await readFiles(store, plugin.db, key)
    const eight = await readFiles(store, plugin.db, { ...key, number: 8 })
    expect(seven.ok && seven.files[0]!.patch).toBe('@@ -1 +1 @@\n-a\n+b')
    expect(eight.ok && eight.files[0]!.patch).toBe('@@ -1 +1 @@\n-z\n+b')
    expect(seven.ok && eight.ok && seven.files[0]!.patchKey !== eight.files[0]!.patchKey).toBe(true)
    expect(seven.ok && seven.files[0]!.patchKey).toBe(patchDigest('@@ -1 +1 @@\n-a\n+b'))
  })

  it('reports a missing available body as an integrity failure, not as a file without a diff', async () => {
    await mirrorFiles(store, plugin.db, key, {
      files: [{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1, sha: 'blob', patch: '@@ patch' }],
      completeness: COMPLETE,
    })
    blobs.clear()
    expect(await readFiles(store, plugin.db, key)).toEqual({ ok: false, missing: 1 })
  })

  it('reads summaries without touching a blob and keeps the patch state', async () => {
    await mirrorFiles(store, plugin.db, key, {
      files: [{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1, sha: 'blob', patch: '@@ patch' }],
      completeness: COMPLETE,
    })
    gets = []
    const read = await readFiles(store, plugin.db, key, { includePatches: false })
    expect(gets).toEqual([])
    expect(read.ok && read.files[0]).toMatchObject({ patchState: 'available', patchKey: patchDigest('@@ patch'), patch: null })
  })

  it('writes no blob for a file GitHub sent no patch for, and reads it back unavailable', async () => {
    await mirrorFiles(store, plugin.db, key, {
      files: [{ filename: 'logo.png', status: 'added', additions: 0, deletions: 0, sha: 'png' }],
      completeness: COMPLETE,
    })
    expect(puts).toEqual([])
    const read = await readFiles(store, plugin.db, key)
    expect(read.ok && read.files[0]).toMatchObject({ path: 'logo.png', patchState: 'unavailable', patchKey: null, patch: null })
    expect(gets).toEqual([])
    expect(patchBlobKey(patchDigest('x'))).toMatch(/^patch:sha256:[0-9a-f]{64}$/)
  })
})

describe('detail mirror', () => {
  it('stores every thread comment in provider order and reads it back that way', async () => {
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ threads: 400, commentsPerThread: (t) => (t === 0 ? 120 : 1), commits: 150 })).fetch)
    expect(await refreshPullDetail('token', plugin.db, refreshKey)).toEqual({ ok: true })

    const detail = await readComposite(plugin.db, key)
    expect(detail.threads).toHaveLength(400)
    expect(detail.threads.map((t) => t.threadId).slice(0, 3)).toEqual(['thread-0', 'thread-1', 'thread-2'])
    expect(detail.threads[0]!.comments.map((c) => c.id)).toEqual(Array.from({ length: 120 }, (_, c) => `thread-0-comment-${c}`))
    expect(detail.commits.map((c) => c.sha)).toEqual(Array.from({ length: 150 }, (_, i) => `commit-${i}`))
  })

  it('keeps the previous detail and its sync time when a continuation fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000)
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ threads: 10 })).fetch)
    await refreshPullDetail('token', plugin.db, refreshKey)
    const before = await plugin.db.select().from(reviewThreads).orderBy(asc(reviewThreads.position))
    const [syncBefore] = await plugin.db.select().from(syncState).where(eq(syncState.resource, prResource(REPO_ID, 7)))

    vi.setSystemTime(2_000)
    vi.stubGlobal('fetch', fakeGithub(makeFakePull({ threads: 250 }), {
      override: (r) => (r.kind === 'graphql-page' && r.after === '200' ? new Response('unavailable', { status: 502 }) : undefined),
    }).fetch)
    expect(await refreshPullDetail('token', plugin.db, refreshKey)).toMatchObject({ ok: false })

    expect(await plugin.db.select().from(reviewThreads).orderBy(asc(reviewThreads.position))).toEqual(before)
    expect((await plugin.db.select().from(syncState).where(eq(syncState.resource, prResource(REPO_ID, 7))))[0]).toEqual(syncBefore)
  })
})
