import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compileWhen,
  contextMenuItems,
  contextMenuRegistry,
  registerContextMenuItems,
  runContextMenuItem,
  type ContextMenuContribution,
  type ItemRowTarget,
  type TaskRowTarget,
} from './contextMenus'

// The registry, its ordering and its `when` evaluation: everything about a context menu that isn't
// pixels. The host is a `<For>` in ./contextMenuHost.tsx and this suite deliberately can't reach it,
// because the repo's vitest has no Solid transform.

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

const item = (over: Partial<ContextMenuContribution<'task.row'>> = {}): ContextMenuContribution<'task.row'> => ({
  id: 'x', location: 'task.row', label: 'X', order: 500, run: () => {}, ...over,
})

// A row in a tracker's list: the second location, added when three lists needed one menu
// (docs/plugins.md § Context menus).
const rowTarget = (over: Partial<ItemRowTarget> = {}): ItemRowTarget => ({
  location: 'item.row',
  id: 'RB-4412',
  title: 'TypeError in pullsBatch',
  providerId: 'rollbar',
  projectId: 'p1',
  item: { id: 'RB-4412' },
  ...over,
})

const disposables: { dispose(): void }[] = []
const register = <L extends 'task.row' | 'item.row'>(items: ContextMenuContribution<L>[]) => {
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

describe('an item row', () => {
  // The registry is what stops the Rollbar, Linear and GitHub lists from offering different things,
  // so the question every one of them asks is "what does this provider's row get".
  it('offers a row keyed to one provider on that provider and nowhere else', () => {
    register([
      { id: 'rollbar.only', location: 'item.row', label: 'Investigate', order: 10, when: compileWhen({ providerId: 'rollbar' }), run: () => {} },
      { id: 'anywhere', location: 'item.row', label: 'Start workflow…', order: 20, run: () => {} },
    ])
    expect(contextMenuItems('item.row', rowTarget()).map((row) => row.id)).toEqual(['rollbar.only', 'anywhere'])
    expect(contextMenuItems('item.row', rowTarget({ providerId: 'linear' })).map((row) => row.id)).toEqual(['anywhere'])
  })

  it('keeps the two locations apart', () => {
    register([item({ id: 'task.pin' })])
    expect(contextMenuItems('item.row', rowTarget())).toEqual([])
    expect(contextMenuItems('task.row', target())).toHaveLength(1)
  })

  it('hands the whole row through, not only its facts', () => {
    const run = vi.fn()
    const pull = { number: 42, headRef: 'james/fix' }
    register([{ id: 'workflows.start', location: 'item.row', label: 'Start workflow…', order: 20, run }])
    const target = rowTarget({ providerId: 'github', item: pull, body: 'the description', link: 'https://example.test/42' })
    runContextMenuItem(contextMenuItems('item.row', target)[0], target)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ item: pull, body: 'the description' }))
  })
})

describe('a declared `when`, compiled', () => {
  // The plugin half: a manifest can't carry a function, so the map it does carry has to evaluate to the
  // same thing core's predicates do.
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
    // unhandled error from a component that's no longer on screen.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => runContextMenuItem(item({ id: 'boom', run: () => { throw new Error('nope') } }), target())).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
