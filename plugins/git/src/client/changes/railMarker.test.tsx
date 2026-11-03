import { createEffect, createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import type { LocalChange } from '@acorn/protocol/localGit.ts'

const [revision, setRevision] = createSignal(0)
const [dirtyCount, setDirtyCount] = createSignal(1)
let changes: LocalChange[] = [{ path: 'a.ts', status: 'modified', staged: false, additions: 2, deletions: 0 }]
let reads = 0
vi.mock('@acorn/plugin-api/client', () => ({
  taskStatus: () => ({ dirty: true, dirtyCount: dirtyCount(), branch: 'main', head: 'abc' }),
  taskStatusRevision: revision,
}))
vi.mock('./changesClient', () => ({
  localGitApi: {
    status: async () => {
      reads += 1
      return { changes }
    },
  },
}))

const { changesRailMarkerContribution } = await import('./railMarker')
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const poll = async () => {
  setRevision((value) => value + 1)
  await settle()
}
let dispose = () => {}
afterEach(() => dispose())

it('reads a dirty task again when its poll summary moves, or on the backstop, not on every poll', async () => {
  let runs = 0
  let dot: string | undefined
  createRoot((done) => {
    dispose = done
    for (const id of ['a', 'b', 'c']) {
      createEffect(() => {
        const markers = changesRailMarkerContribution.markers({ kind: 'task', id })
        if (id !== 'a') return
        runs += 1
        dot = markers[0]?.dotTone
      })
    }
  })
  await settle()
  expect(dot).toBe('ok')
  expect(reads).toBe(3)

  // An idle stretch: five polls with the same summary wake each row once and read nothing.
  const before = runs
  changes = [{ path: 'a.ts', status: 'modified', staged: false, additions: 0, deletions: 3 }]
  for (let count = 0; count < 5; count++) await poll()
  expect(runs - before).toBe(5)
  expect(reads).toBe(3)
  expect(dot).toBe('ok')

  // The sixth poll is the backstop, and it picks up the line counts that moved under the same summary.
  await poll()
  expect(reads).toBe(6)
  expect(dot).toBe('bad')

  // A summary that moves reads at once.
  setDirtyCount(2)
  await settle()
  expect(reads).toBe(9)
})
