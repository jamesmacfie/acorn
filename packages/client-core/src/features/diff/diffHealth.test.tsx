import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { DiffThread } from '../../kit/diff/diffModel'
import { _resetSurfaceHealth, surfaceHealthSnapshot, type SurfaceHealthEntry } from '../../kit/lib/surfaceHealth'
import { largeDiffFiles, largeDiffSource, largeDiffSummary, type LargeDiffFile } from '../../testkit/largeDiff'
import { installDiffLayout } from './layout.helper'

// The diff's health reading against the real pane and the generated fixture (./diffHealth.ts). jsdom
// has no layout, so the scroller is given a height and every other element a row's, which is enough
// for the virtualizer to mount a window of rows; coverage by rect is the real window's to check.

vi.mock('../../infra/highlight/worker', () => ({
  tokenizeDocument: async (_path: string, code: string) => code.split('\n').map((line) => [{ content: line, light: '', dark: '' }]),
}))

const { DiffPane } = await import('./DiffPane')

const cleanups: (() => void)[] = []

beforeEach(() => {
  cleanups.push(installDiffLayout())
})

afterEach(() => {
  cleanups.splice(0).reverse().forEach((dispose) => dispose())
  _resetSurfaceHealth()
})

const mount = (files: LargeDiffFile[], threads?: () => DiffThread[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => (
    <QueryClientProvider client={client}><DiffPane source={largeDiffSource(files, { threads })} /></QueryClientProvider>
  ), host)
  let disposed = false
  const unmount = () => {
    if (disposed) return
    disposed = true
    dispose()
    host.remove()
  }
  cleanups.push(unmount)
  return unmount
}

const diff = (): SurfaceHealthEntry | undefined => surfaceHealthSnapshot().surfaces.find((entry) => entry.kind === 'diff')

describe('the diff health probe', () => {
  it('reports the whole topology once ready, a mounted window, and nothing left behind on teardown', async () => {
    const files = [...largeDiffFiles('small', 1)]
    const summary = largeDiffSummary('small', 1)
    const unmount = mount(files)

    await vi.waitFor(() => expect(diff()?.topology.ready).toBe(true), { timeout: 20_000, interval: 50 })
    const ready = diff()!
    // Every row the fixture says it has, with the source's threads counted apart as dynamic blocks.
    expect(ready.topology.files).toBe(summary.files)
    expect(ready.topology.fixedRows).toBe(summary.fixedRows)
    expect(ready.topology.dynamicBlocks).toBe(summary.threads)
    expect(ready.topology.lateSourceBlocks).toBe(0)
    expect(ready.topology.segments).toBeGreaterThan(summary.files)

    // Only the segments near the viewport load, and once they have, nothing more is owed.
    await vi.waitFor(() => {
      const now = diff()!
      expect(now.resident.rows).toBeGreaterThan(0)
      expect(now.work.queuedSegments).toBe(0)
      expect(now.measurement.activeObservers).toBeGreaterThan(0)
    }, { timeout: 5_000 })
    const mounted = diff()!
    expect(mounted.resident.estimatedBytes).toBeGreaterThan(0)
    expect(mounted.mounted.segments).toBeGreaterThan(0)
    expect(mounted.resident.segments).toBeLessThan(mounted.topology.segments)
    expect(mounted.mounted.fixedRows).toBeGreaterThan(0)
    // A window, not the document.
    expect(mounted.mounted.fixedRows + mounted.mounted.dynamicBlocks).toBeLessThan(summary.fixedRows / 10)
    expect(mounted.measurement.candidates).toBeGreaterThan(0)

    unmount()
    const snapshot = surfaceHealthSnapshot()
    expect(snapshot.surfaces.filter((entry) => entry.kind === 'diff')).toEqual([])
    const retired = snapshot.retired.diff!
    expect(retired.measurement.activeObservers).toBe(0)
    expect(retired.work.scheduledFrames).toBe(0)
    expect(retired.work.queuedSegments).toBe(0)
    expect(retired.work.heldPublications).toBe(0)
  }, 30_000)

  it('counts a source thread that arrives after ready as late topology, and only that', async () => {
    const files = [...largeDiffFiles('small', 1)]
    const own = files.flatMap((file) => file.threads)
    const [threads, setThreads] = createSignal<DiffThread[]>(own)
    mount(files, threads)
    await vi.waitFor(() => expect(diff()?.topology.ready).toBe(true), { timeout: 20_000, interval: 50 })
    expect(diff()?.topology.lateSourceBlocks).toBe(0)

    // The same threads again, as a refetch returns them: nothing new.
    setThreads([...own])
    expect(diff()?.topology.lateSourceBlocks).toBe(0)
    const anchor = own[0]!
    setThreads([...own, { ...anchor, threadId: 'late-thread', comments: [] }])
    expect(diff()?.topology.lateSourceBlocks).toBe(1)
  }, 30_000)

  it('carries no path, line of code, or comment text in its snapshot', async () => {
    const CANARY = 'CANARY7f3a'
    const files = [...largeDiffFiles('small', 1)].map((file): LargeDiffFile => ({
      ...file,
      path: `${CANARY}/${file.path}`,
      patch: file.patch?.replace(/compute/g, `compute_${CANARY}`) ?? null,
      threads: file.threads.map((thread) => ({
        ...thread,
        threadId: `${CANARY}-${thread.threadId}`,
        path: `${CANARY}/${file.path}`,
        comments: thread.comments.map((comment) => ({ ...comment, body: `${CANARY} ${comment.body}` })),
      })),
      notes: file.notes.map((note) => ({ ...note, path: `${CANARY}/${file.path}`, body: `${CANARY} ${note.body}` })),
    }))
    const unmount = mount(files)
    await vi.waitFor(() => expect(diff()?.topology.ready).toBe(true), { timeout: 20_000, interval: 50 })
    expect(JSON.stringify(surfaceHealthSnapshot())).not.toContain(CANARY)
    unmount()
    expect(JSON.stringify(surfaceHealthSnapshot())).not.toContain(CANARY)
  }, 30_000)
})
