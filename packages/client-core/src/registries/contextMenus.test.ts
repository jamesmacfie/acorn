import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compileWhen,
  contextMenuItems,
  contextMenuRegistry,
  registerContextMenuItems,
  runContextMenuItem,
  type ContextMenuContribution,
  type TaskRowTarget,
} from './contextMenus'

// The registry, its ordering and its `when` evaluation — everything about a context menu that is NOT
// pixels. The host is a `<For>` in ./contextMenuHost.tsx and this suite deliberately cannot reach it:
// the repo's vitest has no Solid transform, so anything worth proving has to be here.

const target = (over: Partial<TaskRowTarget> = {}): TaskRowTarget => ({
  location: 'task.row',
  id: 't1',
  title: 'Ship it',
  origin: 'local',
  projectId: 'p1',
  pinned: false,
  branch: 'me/ship-it',
  ...over,
})

const item = (over: Partial<ContextMenuContribution> = {}): ContextMenuContribution => ({
  id: 'x', location: 'task.row', label: 'X', order: 500, run: () => {}, ...over,
})

const disposables: { dispose(): void }[] = []
const register = (items: ContextMenuContribution[]) => {
  const entry = registerContextMenuItems(items)
  disposables.push(entry)
  return entry
}

afterEach(() => {
  while (disposables.length) disposables.pop()!.dispose()
})

describe('what a location offers', () => {
  it('sorts by declared order and breaks ties on id', () => {
    // Never on registration sequence: core registers at mount and plugins register whenever a roster
    // arrives, so an order derived from arrival would move a menu row under the user.
    register([
      item({ id: 'zebra', order: 10 }),
      item({ id: 'apple', order: 10 }),
      item({ id: 'first', order: 1 }),
    ])
    expect(contextMenuItems('task.row', target()).map((entry) => entry.id)).toEqual(['first', 'apple', 'zebra'])
  })

  it('offers nothing for a location nothing registered against', () => {
    register([item()])
    expect(contextMenuItems('task.row', target())).toHaveLength(1)
  })

  it('filters on `when`, and treats an absent predicate as always', () => {
    register([
      item({ id: 'pin', when: (candidate) => !candidate.pinned }),
      item({ id: 'unpin', when: (candidate) => candidate.pinned }),
      item({ id: 'rename' }),
    ])
    expect(contextMenuItems('task.row', target({ pinned: false })).map((entry) => entry.id)).toEqual(['pin', 'rename'])
    expect(contextMenuItems('task.row', target({ pinned: true })).map((entry) => entry.id)).toEqual(['rename', 'unpin'])
  })

  it('refuses a duplicate id rather than silently replacing one', () => {
    register([item({ id: 'task.pin' })])
    expect(() => register([item({ id: 'task.pin' })])).toThrow(/already registered/)
  })

  it('takes every row with it on dispose', () => {
    const entry = register([item({ id: 'a' }), item({ id: 'b' })])
    expect(contextMenuItems('task.row', target())).toHaveLength(2)
    entry.dispose()
    expect(contextMenuItems('task.row', target())).toEqual([])
    expect(contextMenuRegistry.entries()).toEqual([])
  })
})

describe('a declared `when`, compiled', () => {
  // The plugin half: a manifest cannot carry a function, so the map it does carry has to evaluate to
  // the same thing core's predicates do.
  it('reads the target’s own facts', () => {
    expect(compileWhen({ origin: 'github' })(target({ origin: 'github' }))).toBe(true)
    expect(compileWhen({ origin: 'github' })(target({ origin: 'local' }))).toBe(false)
    expect(compileWhen({ pinned: true, origin: 'local' })(target({ pinned: true }))).toBe(true)
    expect(compileWhen({ pinned: true, origin: 'github' })(target({ pinned: true }))).toBe(false)
  })

  it('is always-true when undefined', () => {
    expect(compileWhen(undefined)(target())).toBe(true)
  })
})

describe('running a row', () => {
  it('runs the contribution against the target it was drawn for', () => {
    const run = vi.fn()
    runContextMenuItem(item({ run }), target({ id: 't7' }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 't7' }))
  })

  it('does not let a throwing row escape into the click handler', () => {
    // The menu has already closed by the time this runs, so the alternative to swallowing is an
    // unhandled error from a component that is no longer on screen.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => runContextMenuItem(item({ id: 'boom', run: () => { throw new Error('nope') } }), target())).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
