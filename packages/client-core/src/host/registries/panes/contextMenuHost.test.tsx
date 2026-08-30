import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenuHost, type ContextMenuOpening } from './contextMenuHost'
import { registerContextMenuItems, type ContextMenuTarget } from './contextMenus'
import type { Disposable } from '../../../kit/lib/registry'

// The right-click door. The registry's decisions — which rows, in what order, filtered by `when` —
// are unit-tested in `contextMenus.test.ts`; this file checks that the host turns those rows into a
// menu, that selecting one runs it, and that a row whose `run` throws does not take the click
// handler with it.

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const target = (overrides: Partial<ContextMenuTarget> = {}): ContextMenuTarget => ({
  location: 'task.row',
  id: 'task-1',
  title: 'Fix the thing',
  origin: 'manual',
  projectId: 'p1',
  pinned: false,
  branch: 'james/fix',
  ...overrides,
})

const mount = (opening: () => ContextMenuOpening | null, onClose = () => {}) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ContextMenuHost location="task.row" ariaLabel="Task actions" opening={opening} onClose={onClose} />, host)
}

// The surface portals out of the mount point, so query the document rather than the container.
const labels = () => [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent?.trim())

afterEach(() => {
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('ContextMenuHost', () => {
  it('draws nothing until a right-click opens it', () => {
    registered.push(registerContextMenuItems([{ id: 'a', location: 'task.row', label: 'Archive', order: 0, run: () => {} }]))

    mount(() => null)

    expect(labels()).toEqual([])
  })

  // `task.row` is the only location in the vocabulary today, so there is no second one to register a
  // row against and prove the location filter here. `contextMenus.test.ts` covers the filter itself
  // over a widened type; what this asserts is order and `when`.
  it('draws the location\'s rows in order, and drops the ones `when` rejects', () => {
    registered.push(
      registerContextMenuItems([
        { id: 'z-unpin', location: 'task.row', label: 'Unpin', order: 1, when: (row) => row.pinned, run: () => {} },
        { id: 'a-pin', location: 'task.row', label: 'Pin', order: 1, when: (row) => !row.pinned, run: () => {} },
        { id: 'open', location: 'task.row', label: 'Open', order: 0, run: () => {} },
      ]),
    )

    mount(() => ({ at: { x: 10, y: 20 }, target: target() }))

    expect(labels()).toEqual(['Open', 'Pin'])
  })

  it('runs the row that was selected, with the target that was right-clicked', () => {
    const ran = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'archive', location: 'task.row', label: 'Archive', order: 0, run: ran }]))

    mount(() => ({ at: { x: 10, y: 20 }, target: target({ id: 'task-9' }) }))
    document.querySelector<HTMLElement>('[role="menuitem"]')?.click()

    expect(ran).toHaveBeenCalledTimes(1)
    expect(ran.mock.calls[0][0]).toMatchObject({ id: 'task-9' })
  })

  it('survives a row whose action throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    registered.push(
      registerContextMenuItems([
        {
          id: 'broken',
          location: 'task.row',
          label: 'Broken',
          order: 0,
          run: () => {
            throw new Error('row exploded')
          },
        },
      ]),
    )

    mount(() => ({ at: { x: 10, y: 20 }, target: target() }))

    // The row has already closed by the time `run` fires, so there is nowhere to show the failure but
    // the console. What must not happen is the shell's click handler going down with it.
    expect(() => document.querySelector<HTMLElement>('[role="menuitem"]')?.click()).not.toThrow()
    vi.restoreAllMocks()
  })

  it('follows the opening signal, so one menu serves a whole list', () => {
    const [opening, setOpening] = createSignal<ContextMenuOpening | null>(null)
    registered.push(registerContextMenuItems([{ id: 'open', location: 'task.row', label: 'Open', order: 0, run: () => {} }]))

    mount(opening)
    expect(labels()).toEqual([])

    setOpening({ at: { x: 4, y: 4 }, target: target() })
    expect(labels()).toEqual(['Open'])

    setOpening(null)
    expect(labels()).toEqual([])
  })
})
