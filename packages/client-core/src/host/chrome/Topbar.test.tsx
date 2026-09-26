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
      account: null, railCollapsed: false, slots: { right },
      pickWorkspace: vi.fn(), pickProject: vi.fn(), pickNode: vi.fn(), openSettings: vi.fn(),
      collapseRail: vi.fn(), navigate, clearCache: vi.fn(),
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
})
