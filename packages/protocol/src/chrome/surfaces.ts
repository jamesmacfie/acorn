/** Data and host verbs supplied to replacement chrome. No renderer or DOM types cross this boundary. */
export type SlotRef = string & { readonly __slotRef: unique symbol }

export type RailMarkerData = {
  id: string
  label: string
  icon?: string
  dotTone?: 'ok' | 'warn' | 'bad' | 'mixed'
  tone?: 'neutral' | 'accent' | 'warn' | 'danger'
  busy?: boolean
  placements: readonly ('top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'bottom-center')[]
  priority?: number
}

export type RailData = {
  sources: readonly {
    id: string
    label: string
    icon: string
    selected: boolean
    markers: readonly RailMarkerData[]
  }[]
  workspaces: readonly { id: string; label: string; active: boolean }[]
  collapsed: boolean
  formFactor: 'desktop' | 'narrow' | 'tui'
  slots: { taskList: SlotRef }
}

export type RailProps = RailData & {
  selectSource(id: string): void
  openWorkspace(id: string): void
  toggleCollapsed(): void
  reorderSources(ids: readonly string[]): void
  createTask(): void
  /** Optional desktop menu door for a replacement provider. The host validates the source. */
  openContextMenu?(id: string, at: { x: number; y: number }): void
}

export type TopbarData = {
  workspace: { id: string; label: string } | null
  workspaces: readonly { id: string; label: string; nodeId: string; nodeLabel: string; projectCount: number }[]
  project: { id: string; label: string } | null
  projects: readonly { id: string; label: string }[]
  projectPickerVisible: boolean
  projectPickerDisabled: boolean
  breadcrumb: readonly { label: string; route?: string }[]
  node: { id: string; label: string; state: string } | null
  nodes: readonly { id: string; label: string; state: string }[]
  account: { label: string; avatar?: string } | null
  railCollapsed: boolean
  /** Whether this host has a folder picker, which `addProject` needs. */
  canAddProject: boolean
  slots: { right: SlotRef }
}

export type TopbarProps = TopbarData & {
  pickWorkspace(id: string, nodeId: string): void
  pickProject(id: string): void
  pickNode(id: string): void
  openSettings(): void
  collapseRail(): void
  navigate(route: string): void
  clearCache(): void | Promise<void>
  addProject(): void
}
