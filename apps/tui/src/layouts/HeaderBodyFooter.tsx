/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { regionFocus } from '../keys/regions'

// `header-body-footer` in cells: one line, the rest, one line. Its projection says "the same" as the
// narrow one, and in a terminal that is literally true — there is nothing to drop and nothing to pin,
// because a column of cells pins by construction.
//
// The body is the focus group; the header and footer are groups of their own only where they hold a
// stop, which a `Composer` in the footer does. Registering all three and letting `firstStop` find
// nothing in the empty ones is cheaper than deciding which is which
// (../keys/regions.ts).
export function HeaderBodyFooter(props: LayoutProps) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={props.regions.header}>
        <box flexDirection="column" ref={regionFocus({ paneId: props.stateKey, regionId: 'header' }, 0)}>
          {props.regions.header!()}
        </box>
      </Show>
      <box
        flexDirection="column"
        flexGrow={1}
        overflow="scroll"
        ref={regionFocus({ paneId: props.stateKey, regionId: 'body' }, 1)}
      >
        {props.regions.body?.()}
      </box>
      <Show when={props.regions.footer}>
        <box flexDirection="column" ref={regionFocus({ paneId: props.stateKey, regionId: 'footer' }, 2)}>
          {props.regions.footer!()}
        </box>
      </Show>
    </box>
  )
}
