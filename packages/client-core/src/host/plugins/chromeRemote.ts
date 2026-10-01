import type { RailData, RailProps, TopbarData, TopbarProps } from '@acorn/protocol/chrome.ts'
import type { OwnerActions } from '../tree/hostRequests'

export const RAIL_ACTIONS = ['selectSource', 'openWorkspace', 'toggleCollapsed', 'reorderSources', 'createTask'] as const
export const TOPBAR_ACTIONS = ['pickWorkspace', 'pickProject', 'pickNode', 'openSettings', 'collapseRail', 'navigate', 'clearCache'] as const

const known = (id: unknown, list: readonly { id: string }[]): string => {
  if (typeof id !== 'string' || !list.some((item) => item.id === id)) throw new Error('That choice is unavailable')
  return id
}

export function railRemote(value: RailProps): { data: RailData; actions: OwnerActions } {
  const { sources, workspaces, collapsed, formFactor, slots } = value
  return {
    data: { sources, workspaces, collapsed, formFactor, slots },
    actions: {
      selectSource: (id) => value.selectSource(known(id, sources)),
      openWorkspace: (id) => value.openWorkspace(known(id, workspaces)),
      toggleCollapsed: () => value.toggleCollapsed(),
      createTask: () => value.createTask(),
      reorderSources: (ids) => {
        if (!Array.isArray(ids) || ids.length !== sources.length ||
          ids.some((id) => typeof id !== 'string') || new Set(ids).size !== sources.length ||
          ids.some((id) => !sources.some((source) => source.id === id))) {
          throw new Error('Source order must contain each available source once')
        }
        value.reorderSources(ids)
      },
    },
  }
}

export function topbarRemote(value: TopbarProps): { data: TopbarData; actions: OwnerActions } {
  const { workspace, workspaces, project, projects, projectPickerVisible, projectPickerDisabled,
    breadcrumb, node, nodes, account, railCollapsed, slots } = value
  return {
    data: { workspace, workspaces, project, projects, projectPickerVisible, projectPickerDisabled,
      breadcrumb, node, nodes, account, railCollapsed, slots },
    actions: {
      pickWorkspace: (selection) => {
        const selected = selection as { id?: unknown; nodeId?: unknown } | null
        if (!selected || typeof selected.nodeId !== 'string') throw new Error('Workspace selection is unavailable')
        const entry = workspaces.find((item) => item.id === selected.id && item.nodeId === selected.nodeId)
        if (!entry) throw new Error('Workspace selection is unavailable')
        value.pickWorkspace(entry.id, entry.nodeId)
      },
      pickProject: (id) => value.pickProject(known(id, projects)),
      pickNode: (id) => value.pickNode(known(id, nodes)),
      openSettings: () => value.openSettings(),
      collapseRail: () => value.collapseRail(),
      navigate: (route) => {
        if (typeof route !== 'string' || !breadcrumb.some((item) => item.route === route)) {
          throw new Error('That breadcrumb is unavailable')
        }
        value.navigate(route)
      },
      clearCache: () => value.clearCache(),
    },
  }
}
