import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenuHost, type ContextMenuOpening } from './contextMenuHost'
import {
  contextMenuRegistry,
  fileMenuTarget,
  registerContextMenuItems,
  type ContextMenuLocation,
  type TaskRowTarget,
} from './contextMenus'
import type { Disposable } from '../../../kit/lib/state/registry'
import { paneRegistry } from './panes'

// The right-click door. The registry's decisions — which rows, in what order, filtered by `when` —
// are unit-tested in `contextMenus.test.ts`; this file checks that the host turns those rows into a
// menu, that selecting one runs it, and that a row whose `run` throws does not take the click
// handler with it.

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const target = (overrides: Partial<TaskRowTarget> = {}): TaskRowTarget => ({
  location: 'task.row',
  id: 'task-1',
  title: 'Fix the thing',
  origin: 'manual',
  projectId: 'p1',
  pinned: false,
  branch: 'james/fix',
  ...overrides,
})

const mount = (
  opening: () => ContextMenuOpening | null,
  onClose = () => {},
  location: ContextMenuLocation = 'task.row',
) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => <ContextMenuHost location={location} ariaLabel="Actions" opening={opening} onClose={onClose} />,
    host,
  )
}

const fileTarget = (path: string, directory = false) =>
  fileMenuTarget('file.row', {
    nodeId: 'node-a',
    ownerPluginId: 'editor',
    taskId: 'task-1',
    projectId: 'p1',
    path,
    title: path,
    directory,
    readOnly: false,
  })

// The surface portals out of the mount point, so query the document rather than the container.
const labels = () => [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent?.trim())

afterEach(() => {
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('ContextMenuHost', () => {
  it('draws nothing until a right-click opens it', () => {
    registered.push(
      registerContextMenuItems([{ id: 'a', location: 'task.row', label: 'Archive', order: 0, run: () => {} }]),
    )

    mount(() => null)

    expect(labels()).toEqual([])
  })

  it("draws the location's rows in order, and drops the ones `when` rejects", () => {
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
    registered.push(
      registerContextMenuItems([{ id: 'archive', location: 'task.row', label: 'Archive', order: 0, run: ran }]),
    )

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
    registered.push(
      registerContextMenuItems([{ id: 'open', location: 'task.row', label: 'Open', order: 0, run: () => {} }]),
    )

    mount(opening)
    expect(labels()).toEqual([])

    setOpening({ at: { x: 4, y: 4 }, target: target() })
    expect(labels()).toEqual(['Open'])

    setOpening(null)
    expect(labels()).toEqual([])
  })

  it('offers file rows from any plugin, matched on the file facts', () => {
    const ran = vi.fn()
    registered.push(
      registerContextMenuItems([
        {
          id: 'inspect',
          location: 'file.row',
          label: 'Inspect JSON',
          order: 0,
          when: (row) => row.extension === 'json' && !row.directory,
          run: ran,
        },
        { id: 'tab-only', location: 'document.tab', label: 'Tab only', order: 0, run: () => {} },
      ]),
    )
    // A plugin-owned row needs no surface: a file belongs to the owner that draws it, not to the
    // plugin offering an action on it.
    registered.push(
      contextMenuRegistry.register(
        { id: 'plugin:other:copy', location: 'file.row', label: 'Copy elsewhere', order: 1, run: () => {} },
        'other',
      ),
    )

    const [opening, setOpening] = createSignal<ContextMenuOpening | null>({
      at: { x: 1, y: 1 },
      target: fileTarget('src/Data.JSON'),
    })
    mount(opening, () => {}, 'file.row')
    expect(labels()).toEqual(['Inspect JSON', 'Copy elsewhere'])
    document.querySelector<HTMLElement>('[role="menuitem"]')?.click()
    expect(ran.mock.calls[0][0]).toMatchObject({ path: 'src/Data.JSON', extension: 'json', taskId: 'task-1' })

    setOpening({ at: { x: 1, y: 1 }, target: fileTarget('fixtures.json', true) })
    expect(labels()).toEqual(['Copy elsewhere'])
  })

  it('never runs a row whose registration was replaced while the menu stayed open', () => {
    const first = vi.fn()
    const second = vi.fn()
    const handle = registerContextMenuItems([
      { id: 'inspect', location: 'file.row', label: 'Inspect', order: 0, run: first },
    ])
    mount(
      () => ({ at: { x: 1, y: 1 }, target: fileTarget('a.json') }),
      () => {},
      'file.row',
    )
    const row = document.querySelector<HTMLElement>('[role="menuitem"]')!
    // The plugin reloads under the open menu: same id, new code.
    handle.dispose()
    registered.push(
      registerContextMenuItems([{ id: 'inspect', location: 'file.row', label: 'Inspect', order: 0, run: second }]),
    )
    row.click()
    expect(first).not.toHaveBeenCalled()
  })

  it('still keeps a plugin rail row off a pane another plugin owns', () => {
    // The location vocabulary grew, and the rail ownership rule must not have loosened with it.
    registered.push(
      paneRegistry.register({ id: 'board', label: 'Board', glyph: 'list', order: 1, component: () => null }, 'board'),
    )
    registered.push(
      contextMenuRegistry.register(
        { id: 'plugin:intruder:x', location: 'rail.pane', surface: 'board', label: 'Intrude', order: 0, run: () => {} },
        'intruder',
      ),
    )
    registered.push(
      contextMenuRegistry.register(
        { id: 'plugin:board:y', location: 'rail.pane', surface: 'board', label: 'Own row', order: 1, run: () => {} },
        'board',
      ),
    )
    mount(
      () => ({
        at: { x: 1, y: 1 },
        target: {
          location: 'rail.pane',
          id: 'board',
          title: 'Board',
          nodeId: 'node-a',
          taskId: 'task-1',
          projectId: 'p1',
          pinned: false,
          shown: true,
        },
      }),
      () => {},
      'rail.pane',
    )
    expect(labels()).toEqual(['Own row'])
  })
})
