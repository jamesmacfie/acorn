import { describe, expect, it, vi } from 'vitest'
import type { PaneSwitcherProps } from '@acorn/protocol/paneSwitcher.ts'
import { PANE_SWITCHER_ACTIONS, paneSwitcherRemote } from './paneSwitcherRemote'

const props = (): PaneSwitcherProps => ({
  panes: [{ id: 'changes', label: 'Changes', icon: 'git-diff', shown: true, pinned: false }],
  task: { id: 'task-1', title: 'Review', projectId: 'project-1' },
  maximized: null,
  show: vi.fn(), add: vi.fn(), close: vi.fn(), pin: vi.fn(), toggleMaximize: vi.fn(), equalize: vi.fn(), openContextMenu: vi.fn(),
})

describe('pane switcher worker contract', () => {
  it('passes only cloneable data and binds each declared verb to the host', () => {
    const host = props()
    const remote = paneSwitcherRemote(host)
    expect(structuredClone(remote.data)).toEqual(remote.data)
    expect(Object.keys(remote.actions).sort()).toEqual([...PANE_SWITCHER_ACTIONS].sort())
    remote.actions.show?.('changes')
    remote.actions.equalize?.(null)
    expect(host.show).toHaveBeenCalledWith('changes')
    expect(host.equalize).toHaveBeenCalledOnce()
    remote.actions.openContextMenu?.({ id: 'changes', at: { x: 20, y: 30 } })
    expect(host.openContextMenu).toHaveBeenCalledWith('changes', { x: 20, y: 30 })
  })

  it('refuses an action for a pane the host did not offer', () => {
    const host = props()
    const remote = paneSwitcherRemote(host)
    expect(() => remote.actions.close?.('hidden')).toThrow('not available')
    expect(host.close).not.toHaveBeenCalled()
    expect(() => remote.actions.openContextMenu?.({ id: 'hidden', at: { x: 20, y: 30 } })).toThrow()
  })
})
