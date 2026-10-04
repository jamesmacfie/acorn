import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SlotRef, TopbarProps } from '@acorn/protocol/chrome.ts'
import Topbar from './Topbar'
import { WithNestedChromeSlots } from '../plugins/NestedChromeSlot'

vi.mock('../../features/fleet/NodeChip', () => ({ default: (props: { nodeId: string }) => <span data-node={props.nodeId} /> }))

let dispose: (() => void) | undefined
let host: HTMLElement | undefined
afterEach(() => { dispose?.(); host?.remove(); dispose = undefined; host = undefined })

describe('core topbar', () => {
  it('draws its shell chrome from the shared contract and places status items', () => {
    const right = 'minted-right' as SlotRef
    const navigate = vi.fn()
    const props: TopbarProps = {
      workspace: { id: 'w1', label: 'Work' },
      workspaces: [{ id: 'w1', label: 'Work', nodeId: 'n1', nodeLabel: 'Local', projectCount: 1 }],
      project: { id: 'p1', label: 'Project' }, projects: [{ id: 'p1', label: 'Project' }],
      projectPickerVisible: true, projectPickerDisabled: false,
      breadcrumb: [{ label: 'Project', route: '/p/p1' }, { label: '#4' }],
      node: { id: 'n1', label: 'Local', state: 'online' },
      nodes: [{ id: 'n1', label: 'Local', state: 'online' }],
      account: null, railCollapsed: false, canAddProject: false, slots: { right },
      pickWorkspace: vi.fn(), pickProject: vi.fn(), pickNode: vi.fn(), openSettings: vi.fn(),
      collapseRail: vi.fn(), navigate, clearCache: vi.fn(), addProject: vi.fn(),
    }
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => (
      <WithNestedChromeSlots slots={[{ ref: right, render: () => <span data-status>Ready</span> }]}>
        <Topbar value={props} />
      </WithNestedChromeSlots>
    ), host!)
    expect(host.querySelector('.topbar')).not.toBeNull()
    expect(host.querySelector('[data-node="n1"]')).not.toBeNull()
    expect(host.querySelector('[data-status]')?.textContent).toBe('Ready')
    expect(host.textContent).toContain('#4')
    host.querySelector<HTMLButtonElement>('.breadcrumb button')?.click()
    expect(navigate).toHaveBeenCalledWith('/p/p1')
  })

  it('offers Add project in the workspace switcher only when the host can pick a folder', () => {
    const addProject = vi.fn()
    const base: TopbarProps = {
      workspace: { id: 'w1', label: 'Work' },
      workspaces: [{ id: 'w1', label: 'Work', nodeId: 'n1', nodeLabel: 'Local', projectCount: 0 }],
      project: null, projects: [], projectPickerVisible: false, projectPickerDisabled: false,
      breadcrumb: [], node: null, nodes: [], account: null, railCollapsed: false, canAddProject: true,
      slots: { right: 'minted-right' as SlotRef },
      pickWorkspace: vi.fn(), pickProject: vi.fn(), pickNode: vi.fn(), openSettings: vi.fn(),
      collapseRail: vi.fn(), navigate: vi.fn(), clearCache: vi.fn(), addProject,
    }
    const addButton = () => [...document.querySelectorAll<HTMLButtonElement>('.repo-picker-footer button')]
      .find((button) => button.textContent === 'Add project…')
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => <WithNestedChromeSlots slots={[]}><Topbar value={base} /></WithNestedChromeSlots>, host!)
    host.querySelector<HTMLButtonElement>('.repo-picker button')?.click()
    addButton()?.click()
    expect(addProject).toHaveBeenCalledOnce()
    expect(document.querySelector('.repo-picker-popover')).toBeNull()

    dispose()
    dispose = render(() => <WithNestedChromeSlots slots={[]}><Topbar value={{ ...base, canAddProject: false }} /></WithNestedChromeSlots>, host!)
    host.querySelector<HTMLButtonElement>('.repo-picker button')?.click()
    expect(document.querySelector('.repo-picker-popover')).not.toBeNull()
    expect(addButton()).toBeUndefined()
  })
})
