/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'

// `header-body-footer` in cells: one line, the rest, one line. Its projection says "the same" as the
// narrow one, and in a terminal that is literally true — there is nothing to drop and nothing to pin,
// because a column of cells pins by construction.
export function HeaderBodyFooter(props: LayoutProps) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={props.regions.header}>{props.regions.header!()}</Show>
      <box flexDirection="column" flexGrow={1} overflow="scroll">{props.regions.body?.()}</box>
      <Show when={props.regions.footer}>{props.regions.footer!()}</Show>
    </box>
  )
}
