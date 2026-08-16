import type {
  PluginCollectionField,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import type { PanelView } from '../model'

/** What every view is handed. Rows arrive already shaped and fields already projected — the shaping
 *  layer runs once per panel, not once per view, which is what lets a person flip between views
 *  without losing their filters (composition.md § The four layers). */
export type PanelViewProps = {
  view: PanelView
  schema: PluginCollectionSchema
  fields: PluginCollectionField[]
  rows: PluginCollectionRow[]
  /** The shaping layer's group-by, which only the board draws with — but it lives in shaping rather
   *  than in the view for the same reason the filters do, so it arrives the same way. */
  groupBy?: string
  /** Draw each row's source. True only where the panel unions more than one collection: a badge that
   *  says "github" on every row of a github panel is furniture. No wire change was needed for it —
   *  rows already carry the host's `pluginId` stamp (views/Provenance.tsx). */
  provenance?: boolean
  /** Runs the row's own declared verb through the host dispatcher. Views never act themselves. */
  onActivate: (row: PluginCollectionRow) => void
}
