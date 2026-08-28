import { describe, expect, it } from 'vitest'
import { railStatusMarkers, type RailStatusInputs } from './railStatus'
import { resolveRailMarkers } from '../tabs/railMarkers'
import type { TaskStatus } from '@acorn/protocol/terminal.ts'

const status = (p: Partial<TaskStatus>): TaskStatus => ({ taskId: 't', worktreePath: null, dirty: false, dirtyCount: 0, missing: false, branch: null, head: null, ...p })

const inputs = (over: Partial<RailStatusInputs> = {}): RailStatusInputs => ({
  checks: null, unread: false, status: status({}), archiving: false, pinned: false, ...over,
})

const placements = (over: Partial<RailStatusInputs>) =>
  Object.fromEntries(resolveRailMarkers(railStatusMarkers(inputs(over))).placed.map((m) => [m.id, m.position]))

describe('railStatusMarkers', () => {
  it('emits nothing when the task is idle and clean', () => {
    expect(railStatusMarkers(inputs())).toEqual([])
  })

  it('gives every marker a meaning and exactly one representation', () => {
    const markers = railStatusMarkers(inputs({ checks: 'failure', unread: true, pinned: true, status: status({ dirty: true, dirtyCount: 3 }) }))
    expect(markers.map((m) => m.id)).toEqual(['needs', 'pinned', 'checks', 'dirty'])
    expect(markers.every((m) => m.label && !!m.icon !== !!m.dotTone && m.placements.length)).toBe(true)
    expect(markers.find((m) => m.id === 'dirty')?.label).toBe('Uncommitted changes (3)')
  })

  it('shows repair, not dirty, when the worktree is missing', () => {
    expect(railStatusMarkers(inputs({ status: status({ dirty: true, dirtyCount: 1, missing: true }) })).map((m) => m.id)).toEqual(['repair'])
  })

  it('gives every simultaneous state its own corner', () => {
    // The busiest a core-only row gets: checks, an unread notice, a dirty worktree, pinned.
    expect(placements({ checks: 'pending', unread: true, pinned: true, status: status({ dirty: true, dirtyCount: 2 }) })).toEqual({
      needs: 'top-end',
      pinned: 'top-start',
      checks: 'bottom-end',
      dirty: 'bottom-start',
    })
  })

  it('crowds the pin out of the corner it shares with a missing worktree, without losing it', () => {
    const resolved = resolveRailMarkers(railStatusMarkers(inputs({ pinned: true, unread: true, status: status({ missing: true }) })))
    expect(resolved.placed.map((m) => [m.id, m.position])).toEqual([
      ['needs', 'top-end'], ['repair', 'bottom-end'], ['pinned', 'top-start'],
    ])
    expect(resolved.legend.map((item) => item.l)).toContain('Pinned to top')
  })

  it('gives teardown the slot under the glyph and spins it', () => {
    const resolved = resolveRailMarkers(railStatusMarkers(inputs({ archiving: true, unread: true })))
    expect(resolved.placed.map((m) => [m.id, m.position])).toEqual([['archiving', 'bottom-center'], ['needs', 'top-end']])
    expect(resolved.placed.find((m) => m.id === 'archiving')?.busy).toBe(true)
  })
})
