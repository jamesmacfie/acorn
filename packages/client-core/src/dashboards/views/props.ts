import type {
  PluginCollectionField,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import type { PanelView } from '../model'

  /** What every view is handed: rows already shaped and fields already projected. The shaping
   *  layer runs once per panel, not once per view, which is what lets a person flip between views
   *  without losing their filters (docs/dashboards.md § Views are derived, not chosen from a menu). */
export type PanelViewProps = {
  view: PanelView
  /** The definition's id, for the one view that reads something keyed by it: a stat's history trend
   *  is a series the node stores per panel (dashboards/history.ts). Optional because nothing else
   *  needs it, and a view that draws only what it was handed stays testable. */
  panelId?: string
  schema: PluginCollectionSchema
  fields: PluginCollectionField[]
  rows: PluginCollectionRow[]
  /** The shaping layer's group-by, which only the board draws with. It lives in shaping rather than
   *  in the view for the same reason the filters do, so it arrives the same way. */
  groupBy?: string
  /** Draw each row's source. True only where the panel unions more than one collection: a badge that
   *  says "github" on every row of a github panel is furniture. No wire change was needed for it:
   *  rows already carry the host's `pluginId` stamp (views/Provenance.tsx). */
  provenance?: boolean
  /** Runs the row's own declared verb through the host dispatcher. Views never act themselves. */
  onActivate: (row: PluginCollectionRow) => void
}
