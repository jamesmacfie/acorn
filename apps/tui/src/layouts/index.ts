import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { Layout } from '@acorn/client-core/host/layouts/regions.ts'
import { DocumentOverFrame, FrameBesideDocument } from './DocumentSplit'
import { HeaderBodyFooter } from './HeaderBodyFooter'
import { ListDetail } from './ListDetail'
import { Single } from './Single'
import { StackSplit } from './StackSplit'
import { Tabs } from './Tabs'
import { Wizard } from './Wizard'

// The terminal host's layout table: eight names, seven components, the same mismatch and the same
// reason as the DOM's (docs/panes.md § Layout model). `document-over-frame` and
// `frame-beside-document` are one component with the axis in the name.
//
// Handed to the pane registry through `setLayouts` at boot, which is the seam terminal phase 2 added
// so `paneContributions()` stops handing a second host a component it cannot use
// (client-core/host/layouts/table.ts, docs/tui.md).
//
// A pane declares a name and fills the regions; nothing here is exported to a plugin, and each layout
// is drawn from the terminal projection written beside its desktop one.

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
