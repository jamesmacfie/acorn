/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { Panel } from '../panel'
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
      {/* `flexShrink={0}` on both strips, the rule every block node in the kit keeps: yoga answers a
          height deficit by taking it out of every child that will give, and these two are the only
          children here that would. Once the body took a frame — which refuses to shrink, as a frame
          must — a squeezed header drew no rows at all, and a pane whose list is in its header opened
          with no caret in it (../kit/grouping.tsx). */}
      <Show when={props.regions.header}>
        <box flexDirection="column" flexShrink={0} ref={regionFocus({ paneId: props.stateKey, regionId: 'header' }, 0)}>
          {props.regions.header!()}
        </box>
      </Show>
      {/* The body is framed and the two strips are not, because a frame costs two rows and a pinned
          strip is one row tall: a header in a box would be three rows of chrome round one line of
          content. lazygit draws its status line outside every box for the same reason
          (../panel.tsx). */}
      <Panel grow scroll title={props.label} onBox={regionFocus({ paneId: props.stateKey, regionId: 'body' }, 1)}>
        {props.regions.body?.()}
      </Panel>
      <Show when={props.regions.footer}>
        <box flexDirection="column" flexShrink={0} ref={regionFocus({ paneId: props.stateKey, regionId: 'footer' }, 2)}>
          {props.regions.footer!()}
        </box>
      </Show>
    </box>
  )
}
