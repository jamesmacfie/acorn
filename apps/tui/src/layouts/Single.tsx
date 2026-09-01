/** @jsxImportSource @opentui/solid */
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { Panel } from '../panel'
import { regionFocus } from '../keys/regions'

// `single`: one region, `body`. Its projection is "unchanged" (docs/panes.md § Layout model), and in
// cells that is literally true — a column of cells fills its box by construction.
//
// It earns its name by being declarable: a pane that is one tree still names a layout, so it inherits
// the focus group rather than inventing one.
//
// Framed, and titled with the pane's own name: this layout has one content region, so the useful
// thing to write in its border is which pane it is (../panel.tsx).
export function Single(props: LayoutProps) {
  return (
    <Panel grow scroll title={props.label} onBox={regionFocus({ paneId: props.stateKey, regionId: 'body' }, 0)}>
      {props.regions.body?.()}
    </Panel>
  )
}
