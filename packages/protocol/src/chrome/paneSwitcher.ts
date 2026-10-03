// Data and host verbs for the task pane switcher. A sandbox receives the data through its tree
// mount and invokes the verbs by name; only a compiled provider sees these functions directly.
export type PaneSwitcherPane = {
  id: string
  label: string
  description?: string
  icon: string
  shown: boolean
  pinned: boolean
  shortcut?: string
}

export type PaneSwitcherData = {
  panes: readonly PaneSwitcherPane[]
  task: { id: string; title: string; projectId: string }
  maximized: string | null
}

export type PaneSwitcherProps = PaneSwitcherData & {
  show(id: string): void
  add(id: string): void
  close(id: string): void
  pin(id: string): void
  toggleMaximize(id: string): void
  equalize(): void
  /** Optional desktop menu door for a replacement provider. The host validates the pane. */
  openContextMenu?(id: string, at: { x: number; y: number }): void
}
