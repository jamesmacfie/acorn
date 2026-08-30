import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import { DocumentOverFrame, FrameBesideDocument } from './DocumentSplit'
import { HeaderBodyFooter } from './HeaderBodyFooter'
import { ListDetail } from './ListDetail'
import { Single } from './Single'
import { StackSplit } from './StackSplit'
import { Tabs } from './Tabs'
import { Wizard } from './Wizard'
import type { Layout } from './regions'

// The host's layouts, one per name (docs/panes.md § Layout model).
//
// A pane declares a name and fills the regions; nothing here is exported to a plugin. That is the
// point: responsiveness is paid once per layout instead of once per pane, and a terminal projection
// becomes a property of the layout rather than something every pane has to have an opinion about.

export const LAYOUTS: Record<PaneLayoutName, Layout> = {
  single: Single,
  'list-detail': ListDetail,
  'header-body-footer': HeaderBodyFooter,
  tabs: Tabs,
  'document-over-frame': DocumentOverFrame,
  'frame-beside-document': FrameBesideDocument,
  'stack-split': StackSplit,
  wizard: Wizard,
}

export type { Layout, LayoutProps, Region } from './regions'
export { layoutState } from './state'
