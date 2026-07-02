import { describe, expect, it } from 'vitest'
import { applyLayoutAction, defaultLayout, migrateTaskPanes, normalizeLayout, parseTaskLayouts, type TaskLayout } from './layout'

const l = (partial: Partial<TaskLayout>): TaskLayout => ({ panes: ['pr'], pinned: null, maximised: null, ...partial })

describe('applyLayoutAction — show (today’s single-pane behaviour)', () => {
  it('replaces the only slot when nothing is pinned', () => {
    expect(applyLayoutAction(l({}), { type: 'show', pane: 'editor' })).toEqual(l({ panes: ['editor'] }))
  })
  it('is a no-op when the pane is already visible', () => {
    const cur = l({ panes: ['pr'] })
    expect(applyLayoutAction(cur, { type: 'show', pane: 'pr' })).toBe(cur)
  })
  it('replaces the right slot when split and unpinned', () => {
    expect(applyLayoutAction(l({ panes: ['pr', 'editor'], ratio: 0.5 }), { type: 'show', pane: 'notes' })).toEqual(
      l({ panes: ['pr', 'notes'], ratio: 0.5 }),
    )
  })
  it('honours the pin: clicked pane opens in the other slot', () => {
    const pinned = l({ panes: ['pr'], pinned: 'pr' })
    expect(applyLayoutAction(pinned, { type: 'show', pane: 'changes' })).toEqual(l({ panes: ['pr', 'changes'], pinned: 'pr', ratio: 0.5 }))
    const pinnedRight = l({ panes: ['editor', 'pr'], pinned: 'pr', ratio: 0.6 })
    expect(applyLayoutAction(pinnedRight, { type: 'show', pane: 'changes' })).toEqual(l({ panes: ['changes', 'pr'], pinned: 'pr', ratio: 0.6 }))
  })
  it('clears maximise when switching panes', () => {
    expect(applyLayoutAction(l({ panes: ['pr'], maximised: 'pr' }), { type: 'show', pane: 'editor' })).toEqual(l({ panes: ['editor'] }))
  })
})

describe('applyLayoutAction — split / close', () => {
  it('split opens a second slot with the default ratio', () => {
    expect(applyLayoutAction(l({}), { type: 'split', pane: 'changes' })).toEqual(l({ panes: ['pr', 'changes'], ratio: 0.5 }))
  })
  it('close of the pinned pane clears the pin and falls back to one slot', () => {
    const cur = l({ panes: ['pr', 'changes'], pinned: 'changes', ratio: 0.5 })
    expect(applyLayoutAction(cur, { type: 'close', pane: 'changes' })).toEqual(l({ panes: ['pr'], ratio: 0.5 }))
  })
  it('closing the last pane falls back to the default', () => {
    expect(applyLayoutAction(l({ panes: ['editor'] }), { type: 'close', pane: 'editor' })).toEqual(l({ panes: ['pr'] }))
  })
})

describe('applyLayoutAction — pin / maximise / ratio', () => {
  it('pin requires visibility; unpin clears', () => {
    expect(applyLayoutAction(l({}), { type: 'pin', pane: 'editor' })).toEqual(l({}))
    const pinned = applyLayoutAction(l({}), { type: 'pin', pane: 'pr' })
    expect(pinned.pinned).toBe('pr')
    expect(applyLayoutAction(pinned, { type: 'unpin' }).pinned).toBeNull()
  })
  it('maximise toggles and Esc restores', () => {
    const max = applyLayoutAction(l({}), { type: 'toggleMaximise', pane: 'pr' })
    expect(max.maximised).toBe('pr')
    expect(applyLayoutAction(max, { type: 'toggleMaximise', pane: 'pr' }).maximised).toBeNull()
    expect(applyLayoutAction(max, { type: 'restore' }).maximised).toBeNull()
    expect(applyLayoutAction(l({}), { type: 'toggleMaximise', pane: 'notes' })).toEqual(l({}))
  })
  it('ratio clamps to 0.2–0.8 and only applies when split', () => {
    const split = l({ panes: ['pr', 'editor'], ratio: 0.5 })
    expect(applyLayoutAction(split, { type: 'setRatio', ratio: 0.05 }).ratio).toBe(0.2)
    expect(applyLayoutAction(split, { type: 'setRatio', ratio: 0.95 }).ratio).toBe(0.8)
    expect(applyLayoutAction(split, { type: 'setRatio', ratio: 0.63 }).ratio).toBe(0.63)
    expect(applyLayoutAction(l({}), { type: 'setRatio', ratio: 0.6 })).toEqual(l({}))
  })
})

describe('persistence + migration', () => {
  it('migrates the old task_panes map', () => {
    expect(migrateTaskPanes({ t1: 'editor', t2: 'pr', t3: 'bogus' })).toEqual({
      t1: defaultLayout('editor'),
      t2: defaultLayout('pr'),
    })
  })
  it('parseTaskLayouts prefers task_layouts and falls back to task_panes', () => {
    const layouts = JSON.stringify({ t1: l({ panes: ['pr', 'changes'], pinned: 'pr', ratio: 0.7 }) })
    expect(parseTaskLayouts(layouts, undefined).t1).toEqual(l({ panes: ['pr', 'changes'], pinned: 'pr', ratio: 0.7 }))
    expect(parseTaskLayouts(undefined, JSON.stringify({ t1: 'linear' })).t1).toEqual(defaultLayout('linear'))
    expect(parseTaskLayouts('{not json', JSON.stringify({ t1: 'linear' })).t1).toEqual(defaultLayout('linear'))
  })
  it('normalizeLayout drops junk and out-of-panes pin/maximise', () => {
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout({ panes: ['nope'] })).toBeNull()
    expect(normalizeLayout({ panes: ['pr', 'pr'], pinned: 'editor', maximised: 'editor', ratio: 5 })).toEqual(
      l({ panes: ['pr'], ratio: 0.8 }),
    )
  })
})
