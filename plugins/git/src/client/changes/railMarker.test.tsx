import { createEffect, createRoot, createSignal } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'
import type { LocalChange } from '@acorn/protocol/localGit.ts'

const [revision, setRevision] = createSignal(0)
let changes: LocalChange[] = [{ path: 'a.ts', status: 'modified', staged: false, additions: 2, deletions: 0 }]
vi.mock('@acorn/plugin-api/client', () => ({
  taskStatus: () => ({ dirty: true }),
  taskStatusRevision: revision,
}))
vi.mock('./changesClient', () => ({
  localGitApi: { status: async () => ({ changes }) },
}))

const { changesRailMarkerContribution } = await import('./railMarker')
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
let dispose = () => {}
afterEach(() => dispose())

it('an unchanged answer on the status poll wakes a rail row once, for the poll itself', async () => {
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
  // An idle minute: six ten-second polls, each answering what the last one did.
  const before = runs
  for (let poll = 0; poll < 6; poll++) {
    setRevision((value) => value + 1)
    await settle()
  }
  expect(runs - before).toBe(6)
  changes = [{ path: 'a.ts', status: 'modified', staged: false, additions: 0, deletions: 3 }]
  setRevision((value) => value + 1)
  await settle()
  expect(dot).toBe('bad')
})
