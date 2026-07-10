import { describe, expect, it } from 'vitest'
import { applyLayoutAction, defaultLayout, migrateTaskPanes, normalizeLayout, parseTaskLayouts, type TaskLayout } from './layout'

const layout = (partial: Partial<TaskLayout>): TaskLayout => ({ panes: ['pr'], ...partial })

describe('pane layout reducer', () => {
  it('show preserves pinned panes and replaces only unpinned panes', () => {
    const current = layout({ panes: ['editor', 'pr', 'notes'], pinned: ['editor', 'notes'] })
    expect(applyLayoutAction(current, { type: 'show', pane: 'changes' })).toEqual(
      layout({ panes: ['editor', 'notes', 'changes'], pinned: ['editor', 'notes'] }),
    )
  })

  it('adds once and closes the last unpinned pane back to the default', () => {
    expect(applyLayoutAction(layout({ panes: ['pr'] }), { type: 'add', pane: 'changes' })).toEqual(layout({ panes: ['pr', 'changes'] }))
    const current = layout({ panes: ['pr', 'changes'] })
    expect(applyLayoutAction(current, { type: 'add', pane: 'changes' })).toBe(current)
    expect(applyLayoutAction(layout({ panes: ['editor'] }), { type: 'close', pane: 'editor' })).toEqual(defaultLayout())
  })

  it('unpins on the first close and closes on the second while retaining its weight', () => {
    const current = layout({ panes: ['pr', 'editor'], pinned: ['editor'], weights: { editor: 2 } })
    const unpinned = applyLayoutAction(current, { type: 'close', pane: 'editor' })
    expect(unpinned).toEqual(layout({ panes: ['pr', 'editor'], pinned: [], weights: { editor: 2 } }))
    expect(applyLayoutAction(unpinned, { type: 'close', pane: 'editor' })).toEqual(layout({ panes: ['pr'], pinned: [], weights: { editor: 2 } }))
    expect(applyLayoutAction(layout({ panes: ['pr'], weights: { editor: 2 } }), { type: 'add', pane: 'editor' }).weights?.editor).toBe(2)
  })

  it('pins, reorders, and keeps weights attached to ids', () => {
    let current = layout({ panes: ['pr', 'editor', 'changes'], weights: { editor: 3, changes: 2 } })
    current = applyLayoutAction(current, { type: 'pin', pane: 'editor' })
    current = applyLayoutAction(current, { type: 'move', pane: 'editor', direction: 1 })
    expect(current).toEqual(layout({ panes: ['pr', 'changes', 'editor'], pinned: ['editor'], weights: { editor: 3, changes: 2 } }))
  })

  it('clamps a neighbor resize to both contributed minimum widths', () => {
    const current = layout({ panes: ['pr', 'editor'] })
    const resized = applyLayoutAction(current, {
      type: 'resize', pane: 'pr', adjacent: 'editor', deltaPx: 500,
      paneWidth: 400, adjacentWidth: 400, paneMinWidth: 300, adjacentMinWidth: 260,
    })
    expect(resized.weights).toEqual({ pr: 540, editor: 260 })
  })

  it('equalizes visible panes without dropping stale unknown weights', () => {
    const current = layout({ panes: ['pr', 'editor'], weights: { pr: 3, editor: 2, 'future.pane': 7 } })
    expect(applyLayoutAction(current, { type: 'equalize' }).weights).toEqual({ pr: 1, editor: 1, 'future.pane': 7 })
  })
})

describe('pane layout persistence', () => {
  it('retains unknown ids, weights, and pins so they remain inert rather than lost', () => {
    expect(normalizeLayout({
      panes: ['pr', 'future.pane', 'pr'],
      pinned: ['future.pane'],
      weights: { pr: 1.5, 'future.pane': 4, bad: 0 },
      maximized: 'future.pane',
    })).toEqual(layout({ panes: ['pr', 'future.pane'], pinned: ['future.pane'], weights: { pr: 1.5, 'future.pane': 4 } }))
  })

  it('normalizes legacy shapes without persisting maximize state', () => {
    expect(normalizeLayout({ panes: ['editor', 'pr'], pinned: 'pr', ratio: 0.6 })).toEqual(layout({ panes: ['editor', 'pr'] }))
    expect(normalizeLayout({ active: 'pr', pinned: ['changes', 'future.pane'] })).toEqual(
      layout({ panes: ['pr', 'changes', 'future.pane'], pinned: ['changes', 'future.pane'] }),
    )
  })

  it('migrates task_panes and falls back to it when task_layouts is malformed', () => {
    expect(migrateTaskPanes({ t1: 'editor', t2: '' })).toEqual({ t1: defaultLayout('editor') })
    expect(parseTaskLayouts('{not json', JSON.stringify({ t1: 'linear' })).t1).toEqual(defaultLayout('linear'))
  })
})
