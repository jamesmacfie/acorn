import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from './registry'
import type { UiSlotContext, UiSlotContribution } from './slots'
import { SlotHost, TaskSlotHost, uiSlotRegistry } from './uiSlots'

// The first tests in this repo that render a component. The suite next door is bare Node with no
// Solid transform, so nothing it asserts says whether a contribution reaches the screen
// (docs/testing.md § Test layers).
//
// What is checked here is host machinery: which contributions are drawn, in what order, and what
// happens when one throws. Not appearance. A contribution renders a `<span>` with its id in it,
// because the question this file answers is "did the host draw it", never "did it look right".

const capabilities = vi.hoisted(() => ({ desktop: true, terminal: true }))
vi.mock('../infra/node/hostCapabilities', () => ({
  hasHostCapability: (requirement: 'none' | 'desktop' | 'terminal' = 'none') =>
    requirement === 'none' || capabilities[requirement],
}))

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

// The registry has no `clear`, deliberately: a duplicate id is a programming error, so registration
// hands back the only way to undo it. Tests hold the handles and drop them between cases.
const register = (contribution: UiSlotContribution) => registered.push(uiSlotRegistry.register(contribution))

const mount = (element: () => unknown) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(element as () => never, host)
}

const marks = () => [...host.querySelectorAll('[data-mark]')].map((node) => node.getAttribute('data-mark'))

const context = (): UiSlotContext => ({
  taskActive: true,
  terminalOpen: false,
  toggleTerminal: () => {},
  closeTerminal: () => {},
  openSettings: () => {},
  selectTask: () => {},
  activeTask: null,
})

beforeEach(() => {
  capabilities.desktop = true
  capabilities.terminal = true
})

afterEach(() => {
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('SlotHost', () => {
  it('draws one slot only, ordered by order and then id', () => {
    register({ id: 'b', slot: 'topbar.left', order: 1, component: () => <span data-mark="b" /> })
    register({ id: 'a', slot: 'topbar.left', order: 1, component: () => <span data-mark="a" /> })
    register({ id: 'first', slot: 'topbar.left', order: 0, component: () => <span data-mark="first" /> })
    register({ id: 'elsewhere', slot: 'overlay', order: 0, component: () => <span data-mark="elsewhere" /> })

    mount(() => <SlotHost slot="topbar.left" context={context()} />)

    // `a` before `b` is the id tiebreak at equal order, which is what keeps the paint stable when two
    // plugins pick the same number.
    expect(marks()).toEqual(['first', 'a', 'b'])
  })

  it('drops a contribution the host cannot satisfy', () => {
    capabilities.desktop = false
    register({ id: 'native', slot: 'topbar.left', order: 0, requires: 'desktop', component: () => <span data-mark="native" /> })
    register({ id: 'portable', slot: 'topbar.left', order: 1, component: () => <span data-mark="portable" /> })

    mount(() => <SlotHost slot="topbar.left" context={context()} />)

    expect(marks()).toEqual(['portable'])
  })

  it("honours the contribution's own `when` over the slot context", () => {
    register({
      id: 'needs-task',
      slot: 'topbar.left',
      order: 0,
      when: (ctx) => ctx.taskActive,
      component: () => <span data-mark="needs-task" />,
    })

    mount(() => <SlotHost slot="topbar.left" context={{ ...context(), taskActive: false }} />)

    expect(marks()).toEqual([])
  })

  it('contains a throwing contribution instead of losing the slot', () => {
    register({
      id: 'broken',
      slot: 'topbar.left',
      order: 0,
      component: () => {
        throw new Error('contribution exploded')
      },
    })
    register({ id: 'fine', slot: 'topbar.left', order: 1, component: () => <span data-mark="fine" /> })

    mount(() => <SlotHost slot="topbar.left" context={context()} />)

    // The neighbour still drew, which is the whole point of a boundary per contribution rather than
    // one around the slot.
    expect(marks()).toEqual(['fine'])
    // `topbar.left` is a loud slot, so the failure is visible and recoverable rather than silent.
    expect(host.querySelector('.contribution-failed')).not.toBeNull()
    expect(host.textContent).toContain('broken')
  })

  it('fails quietly in topbar.right, where a placeholder would be worse than nothing', () => {
    register({
      id: 'broken',
      slot: 'topbar.right',
      order: 0,
      component: () => {
        throw new Error('contribution exploded')
      },
    })

    mount(() => <SlotHost slot="topbar.right" context={context()} />)

    expect(host.querySelector('.contribution-failed')).toBeNull()
  })
})

describe('TaskSlotHost', () => {
  it('draws task slots and passes the task id, never the slot context', () => {
    register({
      id: 'footer',
      slot: 'task.footer',
      order: 0,
      component: (props) => <span data-mark={props.taskId} />,
    })

    mount(() => <TaskSlotHost slot="task.footer" taskId="task-7" />)

    expect(marks()).toEqual(['task-7'])
  })

  it('ignores a shell contribution registered on the same registry', () => {
    register({ id: 'shell', slot: 'topbar.left', order: 0, component: () => <span data-mark="shell" /> })

    mount(() => <TaskSlotHost slot="task.footer" taskId="task-7" />)

    expect(marks()).toEqual([])
  })

  it('fails quietly: a broken badge must not put an error card in a task footer', () => {
    register({
      id: 'broken',
      slot: 'task.footer',
      order: 0,
      component: () => {
        throw new Error('badge exploded')
      },
    })

    mount(() => <TaskSlotHost slot="task.footer" taskId="task-7" />)

    expect(host.querySelector('.contribution-failed')).toBeNull()
  })
})
