/** @jsxImportSource @opentui/solid */
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { regionFocus } from '../keys/regions'

// `single`: one region, `body`. Its projection is "unchanged" (docs/panes.md § Layout model), and in
// cells that is literally true — a column of cells fills its box by construction.
//
// It earns its name by being declarable: a pane that is one tree still names a layout, so it inherits
// the focus group rather than inventing one.
export function Single(props: LayoutProps) {
  return (
    <box flexDirection="column" flexGrow={1} ref={regionFocus({ paneId: props.stateKey, regionId: 'body' }, 0)}>
      {props.regions.body?.()}
    </box>
  )
}
