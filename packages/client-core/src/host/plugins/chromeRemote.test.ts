import { describe, expect, it, vi } from 'vitest'
import type { RailProps, SlotRef, TopbarProps } from '@acorn/protocol/chrome.ts'
import { railRemote, topbarRemote } from './chromeRemote'

const slot = 'host-minted' as SlotRef

describe('chrome action boundary', () => {
  it('hands the rail tree data without functions and accepts only visible source IDs', () => {
    const selectSource = vi.fn()
    const openContextMenu = vi.fn()
    const reorderSources = vi.fn()
    const props: RailProps = {
      sources: [{ id: 'home', label: 'Home', icon: 'house', selected: true, markers: [] }],
      workspaces: [{ id: 'w1', label: 'Work', active: true }],
      collapsed: false, formFactor: 'desktop', slots: { taskList: slot },
      selectSource, openWorkspace: vi.fn(), toggleCollapsed: vi.fn(), reorderSources, createTask: vi.fn(), openContextMenu,
    }
    const remote = railRemote(props)
    expect(() => structuredClone(remote.data)).not.toThrow()
    remote.actions.selectSource?.('home')
    expect(selectSource).toHaveBeenCalledWith('home')
    expect(() => remote.actions.selectSource?.('hidden')).toThrow()
    expect(() => remote.actions.reorderSources?.(['hidden'])).toThrow()
    expect(reorderSources).not.toHaveBeenCalled()
    remote.actions.openContextMenu?.({ id: 'home', at: { x: 40, y: 50 } })
    expect(openContextMenu).toHaveBeenCalledWith('home', { x: 40, y: 50 })
    expect(() => remote.actions.openContextMenu?.({ id: 'hidden', at: { x: 40, y: 50 } })).toThrow()
    expect(() => remote.actions.openContextMenu?.({ id: 'home', at: { x: -1, y: 50 } })).toThrow()
  })

  it('rejects node and route choices the topbar did not offer', () => {
    const pickNode = vi.fn()
    const addProject = vi.fn()
    const navigate = vi.fn()
    const props: TopbarProps = {
      workspace: null, workspaces: [], project: null, projects: [],
      projectPickerVisible: false, projectPickerDisabled: false,
      breadcrumb: [{ label: 'Project', route: '/p/one' }],
      node: { id: 'n1', label: 'Local', state: 'online' },
      nodes: [{ id: 'n1', label: 'Local', state: 'online' }],
      account: null, canAddProject: false, slots: { right: slot },
      pickWorkspace: vi.fn(), pickProject: vi.fn(), pickNode, openSettings: vi.fn(),
      navigate, clearCache: vi.fn(), addProject,
    }
    const remote = topbarRemote(props)
    expect(() => structuredClone(remote.data)).not.toThrow()
    remote.actions.pickNode?.('n1')
    expect(pickNode).toHaveBeenCalledWith('n1')
    expect(() => remote.actions.pickNode?.('n2')).toThrow()
    expect(() => remote.actions.navigate?.('/settings')).toThrow()
    expect(navigate).not.toHaveBeenCalled()
    expect(() => remote.actions.addProject?.(undefined)).toThrow()
    expect(addProject).not.toHaveBeenCalled()
  })
})
