import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../../kit/lib/registry'
import { closeRefPanel, openRefPanel, refPanelRegistry, type RefPanelProps, type RefPanelTarget } from './refPanels'
import { RefPanelHost } from './refPanelHost'

// The one place a reference panel is drawn. Two things only a render can show: the panel is resolved
// at render time rather than when the ref was set, and the subject arrives as `target`.
//
// That second one is not hypothetical. Solid compiles a component's `ref` attribute into a setter
// method, so naming this prop `ref` handed every panel a function in place of its subject, and it
// shipped as a blank panel title with every guard on the way in holding.

const capabilities = vi.hoisted(() => ({ desktop: true, terminal: true }))
vi.mock('../../../infra/node/hostCapabilities', () => ({
  hasHostCapability: (requirement: 'none' | 'desktop' | 'terminal' = 'none') =>
    requirement === 'none' || capabilities[requirement],
}))
vi.mock('../../../features/tasks/tasks', () => ({ activeTaskId: () => 'task-1' }))

const clicked = vi.hoisted(() => vi.fn())
vi.mock('./contentLinks', () => ({ handlePluginContentLinkClick: clicked }))

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const panel = (providerId: string, component: (props: RefPanelProps) => unknown, when?: () => boolean) =>
  registered.push(
    refPanelRegistry.register({
      id: `${providerId}-panel`,
      providerId,
      ...(when ? { when } : {}),
      component: component as never,
    }),
  )

const mount = () => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <RefPanelHost />, host)
}

beforeEach(() => {
  capabilities.desktop = true
  clicked.mockReset()
})

afterEach(() => {
  closeRefPanel()
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('RefPanelHost', () => {
  it('draws nothing until a ref is open', () => {
    panel('linear', () => <span data-mark="linear" />)

    mount()

    expect(host.innerHTML).toBe('')
  })

  it('draws the panel for the open ref, and gives it the target rather than a callback', () => {
    let seen: RefPanelTarget | undefined
    panel('linear', (props) => {
      seen = props.target
      return <span data-mark={props.target.displayId} />
    })

    mount()
    openRefPanel({ providerId: 'linear', displayId: 'ENG-42' })

    expect(host.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('ENG-42')
    expect(typeof seen).toBe('object')
    expect(seen?.displayId).toBe('ENG-42')
  })

  it('adds no chrome of its own', () => {
    panel('linear', () => <span data-mark="linear" />)

    mount()
    openRefPanel({ providerId: 'linear', displayId: 'ENG-42' })

    // A panel brings its own overlay and dismiss control, whether it is a first-party component or a
    // manifest-declared frame. A wrapper here letterboxes one and double-frames the other.
    expect(host.innerHTML).toBe('<span data-mark="linear"></span>')
  })

  it('renders nothing when the provider becomes ineligible while the ref is open', () => {
    let live = true
    panel('linear', () => <span data-mark="linear" />, () => live)

    mount()
    openRefPanel({ providerId: 'linear', displayId: 'ENG-42' })
    expect(host.querySelector('[data-mark]')).not.toBeNull()

    // Resolved at render time, not when the ref was set: a plugin can be disabled or a node switched
    // between the two, and drawing nothing is the right degradation for a detail overlay.
    live = false
    closeRefPanel()
    openRefPanel({ providerId: 'linear', displayId: 'ENG-42' })
    expect(host.querySelector('[data-mark]')).toBeNull()
  })

  it('routes a link clicked inside a panel back through the host, preferring the panel', () => {
    panel('linear', (props) => (
      // `#`, not a real URL: the handler is mocked here so nothing calls `preventDefault`, and jsdom
      // logs an unimplemented-navigation warning for an absolute href. What is asserted is the call,
      // not the destination.
      <a data-mark="link" href="#" onClick={props.onContentClick}>
        ENG-9
      </a>
    ))

    mount()
    openRefPanel({ providerId: 'linear', displayId: 'ENG-42' })
    host.querySelector('a')?.click()

    // A ticket linking a sibling ticket swaps this panel rather than pushing a pane behind it: the
    // reader asked to look sideways, twice.
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(clicked.mock.calls[0][1]).toEqual({ taskId: 'task-1', prefer: 'refPanel' })
  })

  it('closes through the host, so a panel does not have to own the signal', () => {
    panel('linear', (props) => <button data-mark="close" onClick={props.onClose} />)

    mount()
    openRefPanel({ providerId: 'linear', displayId: 'ENG-42' })
    host.querySelector('button')?.click()

    expect(host.innerHTML).toBe('')
  })
})
