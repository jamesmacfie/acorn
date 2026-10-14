/** Layout props shared by the DOM, terminal, and remote tree adapters. */
type LayoutSpace = 'none' | 'inline' | 'row' | 'stack' | 'section'

/** A bounded column. Content above and below its body keeps its natural height. */
export interface PaneProps<Child = unknown> {
  gap?: LayoutSpace
  children: Child
}

/** A run of content, or a bounded column when grow is set. */
export interface StackProps<Child = unknown> extends PaneProps<Child> {
  /** Fill the region so a child viewport has a height to scroll against. */
  grow?: boolean
}

export interface TabPanelProps<Child = unknown> {
  idPrefix: string
  id: string
  active: string
  children: Child
  /** False when a child such as Log owns scrolling. Defaults to true. */
  scroll?: boolean
  scrollOffset?: number
  padding?: 'pane'
  onChange?: (offset: number) => void
}
