import { describe, expect, it } from 'vitest'
import {
  diffCollapsed,
  diffScroll,
  evictDiffViewStates,
  rememberDiffCollapsed,
  rememberDiffScroll,
} from './viewState'

/** A place in the fixed rows of one segment, `fixed` pixels in. */
const row = (fixed: number) => ({ at: 'row' as const, key: 's:src/a.ts:0', path: 'src/a.ts', index: 1, fixed })

describe('diff view state', () => {
  it('isolates a task scope from the same content viewed outside a task', () => {
    const taskScope = { taskId: 'diff-state-task', routeKey: 'oak/acorn#42' }
    const browseScope = { routeKey: 'oak/acorn#42' }
    rememberDiffScroll(taskScope, {
      place: row(4_800),
      left: 120,
      viewMode: 'split',
      filesSignature: 'src/a.ts:sha',
    })
    rememberDiffScroll(browseScope, {
      place: row(80),
      left: 0,
      viewMode: 'unified',
      filesSignature: 'src/a.ts:sha',
    })

    expect(diffScroll(taskScope)).toEqual({
      place: row(4_800),
      left: 120,
      viewMode: 'split',
      filesSignature: 'src/a.ts:sha',
    })
    expect(diffScroll(browseScope)?.place).toEqual(row(80))
  })

  it('keeps collapsed files beside the scroll position without clobbering it', () => {
    const scope = { routeKey: 'oak/acorn#7' }
    rememberDiffScroll(scope, { place: row(640), left: 0, viewMode: 'unified', filesSignature: 'sig-1' })
    rememberDiffCollapsed(scope, { filesSignature: 'sig-1', paths: ['src/a.ts', 'src/b.ts'] })

    expect(diffCollapsed(scope)).toEqual({ filesSignature: 'sig-1', paths: ['src/a.ts', 'src/b.ts'] })
    expect(diffScroll(scope)?.place).toEqual(row(640))
    expect(diffCollapsed({ taskId: 'other-task', routeKey: 'oak/acorn#7' })).toBeUndefined()
  })

  it('evicts every position owned by an archived task', () => {
    const first = { taskId: 'archived-diff-task', routeKey: 'oak/acorn#1' }
    const second = { taskId: 'archived-diff-task', routeKey: 'oak/acorn#2' }
    const retained = { routeKey: 'oak/acorn#1' }
    rememberDiffScroll(first, { place: row(10), left: 0, viewMode: 'unified', filesSignature: 'signature' })
    rememberDiffScroll(second, { place: row(20), left: 0, viewMode: 'unified', filesSignature: 'signature' })
    rememberDiffCollapsed(second, { filesSignature: 'signature', paths: ['src/a.ts'] })
    rememberDiffScroll(retained, { place: row(30), left: 0, viewMode: 'unified', filesSignature: 'signature' })

    evictDiffViewStates('archived-diff-task')

    expect(diffScroll(first)).toBeUndefined()
    expect(diffScroll(second)).toBeUndefined()
    expect(diffCollapsed(second)).toBeUndefined()
    expect(diffScroll(retained)?.place).toEqual(row(30))
  })
})
