import type { RailData, RailProps, TopbarData, TopbarProps } from '@acorn/protocol/chrome.ts'
import type { OwnerActions } from '../tree/hostRequests'

export const RAIL_ACTIONS = ['selectSource', 'openWorkspace', 'toggleCollapsed', 'reorderSources', 'createTask', 'openContextMenu'] as const
export const TOPBAR_ACTIONS = ['pickWorkspace', 'pickProject', 'pickNode', 'openSettings', 'collapseRail', 'navigate', 'clearCache', 'addProject'] as const

const known = (id: unknown, list: readonly { id: string }[]): string => {
  if (typeof id !== 'string' || !list.some((item) => item.id === id)) throw new Error('That choice is unavailable')
  return id
}

const point = (value: unknown): { x: number; y: number } => {
  const at = value as { x?: unknown; y?: unknown } | null
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) ||
    (at.x as number) < 0 || (at.y as number) < 0 ||
    (at.x as number) > 100_000 || (at.y as number) > 100_000) throw new Error('Menu point is unavailable')
  return { x: at.x as number, y: at.y as number }
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
      openContextMenu: (payload) => {
        if (!value.openContextMenu || !payload || typeof payload !== 'object') return
        const request = payload as { id?: unknown; at?: unknown }
        value.openContextMenu(known(request.id, sources), point(request.at))
      },
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
    breadcrumb, node, nodes, account, railCollapsed, canAddProject, slots } = value
  return {
    data: { workspace, workspaces, project, projects, projectPickerVisible, projectPickerDisabled,
      breadcrumb, node, nodes, account, railCollapsed, canAddProject, slots },
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
      addProject: () => {
        if (!canAddProject) throw new Error('Adding a project is unavailable')
        value.addProject()
      },
    },
  }
}
