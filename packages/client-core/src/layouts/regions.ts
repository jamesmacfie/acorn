import type { JSX } from 'solid-js'
import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'

// What every layout is handed. See docs/panes.md § Layout model for the two layers of layout and
// docs/panes.md § Layout model for each layout's regions and its narrow and terminal projections.
//
// One props type for all seven layouts rather than seven, because the render path in
// registries/panes.ts and, from phase 3, the remote root both build these props without knowing which
// layout they are building for. A layout reads the fields it has regions for and ignores the rest.

/**
 * A region's contents, as a thunk.
 *
 * A thunk rather than an element, so a layout that draws one region at a time (`tabs`, and `wizard`)
 * never mounts the ones it is not showing.
 */
export type Region = () => JSX.Element

export type LayoutProps = {
  /** The pane id. Keys the host's per-pane layout state: the selected tab, the split position. */
  stateKey: string
  /** The pane's label, for the landmark names a layout puts on its regions. */
  label: string
  regions: Partial<Record<string, Region>>
  /** Regions the pane is not showing right now. A layout drops them and gives their space to the
   *  regions that are left, which is also the mechanism the narrow projections need. */
  hidden?: readonly string[]
  /** `tabs` only. The bar, in order; each entry has a `panel:<id>` region. */
  tabs?: readonly { id: string; label: string }[]
  /** `wizard` only. The host draws the indicator from these and the back and next controls. */
  steps?: readonly { id: string; label: string }[]
  current?: string
  onStep?: (id: string) => void
  /** `wizard` only. Blocks next while the step is incomplete. */
  canAdvance?: boolean
}

export type Layout = (props: LayoutProps) => JSX.Element

export type { PaneLayoutName }
