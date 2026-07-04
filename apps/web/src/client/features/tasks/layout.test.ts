import { describe, expect, it } from 'vitest'
import { applyLayoutAction, defaultLayout, migrateTaskPanes, normalizeLayout, parseTaskLayouts, type TaskLayout } from './layout'

const l = (partial: Partial<TaskLayout>): TaskLayout => ({ panes: ['pr'], ...partial })

describe('applyLayoutAction — show', () => {
  it('shows just the clicked pane, replacing the row', () => {
    expect(applyLayoutAction(l({ panes: ['pr', 'changes'] }), { type: 'show', pane: 'editor' })).toEqual(l({ panes: ['editor'] }))
  })
  it('is a no-op when it is already the only open pane', () => {
    const cur = l({ panes: ['pr'] })
    expect(applyLayoutAction(cur, { type: 'show', pane: 'pr' })).toBe(cur)
  })
})

describe('applyLayoutAction — add (⌘-click)', () => {
  it('opens the pane to the right of the open ones', () => {
    expect(applyLayoutAction(l({ panes: ['pr'] }), { type: 'add', pane: 'changes' })).toEqual(l({ panes: ['pr', 'changes'] }))
    expect(applyLayoutAction(l({ panes: ['pr', 'changes'] }), { type: 'add', pane: 'notes' })).toEqual(l({ panes: ['pr', 'changes', 'notes'] }))
  })
  it('is a no-op when already open', () => {
    const cur = l({ panes: ['pr', 'changes'] })
    expect(applyLayoutAction(cur, { type: 'add', pane: 'changes' })).toBe(cur)
  })
})

describe('applyLayoutAction — close', () => {
  it('removes the pane', () => {
    expect(applyLayoutAction(l({ panes: ['pr', 'changes'] }), { type: 'close', pane: 'changes' })).toEqual(l({ panes: ['pr'] }))
  })
  it('closing the last pane falls back to the default', () => {
    expect(applyLayoutAction(l({ panes: ['editor'] }), { type: 'close', pane: 'editor' })).toEqual(l({ panes: ['pr'] }))
  })
  it('is a no-op for a pane that is not open', () => {
    const cur = l({ panes: ['pr'] })
    expect(applyLayoutAction(cur, { type: 'close', pane: 'changes' })).toBe(cur)
  })
})

describe('applyLayoutAction — replace (recipe seeding)', () => {
  it('replaces wholesale after validation; junk keeps the current layout', () => {
    const next = l({ panes: ['pr', 'changes'] })
    expect(applyLayoutAction(l({}), { type: 'replace', layout: next })).toEqual(next)
    const junk = { panes: ['nope'] } as unknown as TaskLayout
    expect(applyLayoutAction(l({}), { type: 'replace', layout: junk })).toEqual(l({}))
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
    const layouts = JSON.stringify({ t1: l({ panes: ['pr', 'changes'] }) })
    expect(parseTaskLayouts(layouts, undefined).t1).toEqual(l({ panes: ['pr', 'changes'] }))
    expect(parseTaskLayouts(undefined, JSON.stringify({ t1: 'linear' })).t1).toEqual(defaultLayout('linear'))
    expect(parseTaskLayouts('{not json', JSON.stringify({ t1: 'linear' })).t1).toEqual(defaultLayout('linear'))
  })
  it('normalizeLayout drops junk, dedupes, and ignores the legacy maximised field', () => {
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout({ panes: ['nope'] })).toBeNull()
    expect(normalizeLayout({ panes: ['pr', 'pr', 'changes', 'bogus'], maximised: 'notes' })).toEqual(l({ panes: ['pr', 'changes'] }))
    expect(normalizeLayout({ panes: ['pr', 'changes'], maximised: 'changes' })).toEqual(l({ panes: ['pr', 'changes'] }))
  })
  it('normalizeLayout collapses the legacy slot + pin shapes into the flat row', () => {
    // Legacy 2-slot + slot-lock pin → the panes array (pinned/ratio dropped).
    expect(normalizeLayout({ panes: ['editor', 'pr'], pinned: 'pr', ratio: 0.6 })).toEqual(l({ panes: ['editor', 'pr'] }))
    // Short-lived { active, pinned[] } pin model → active first, then the pinned column.
    expect(normalizeLayout({ active: 'pr', pinned: ['changes', 'notes'] })).toEqual(l({ panes: ['pr', 'changes', 'notes'] }))
  })
})
