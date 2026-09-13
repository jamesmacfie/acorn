import type { JSX } from 'solid-js'
import { roleVar } from '../../tokens/roles'
import type { Space } from '../../tokens/tokens'

/* Inline: children side by side. Stack's sibling, and the other half of what a raw `div` was doing.

   Not Toolbar, which is a bar with a role and a border; this is grouping and nothing else.

   At 80×24: children on one line separated by a space, wrapping to a Stack when too wide. */
export function Inline(props: { gap?: Space; wrap?: boolean; spread?: boolean; children: JSX.Element }) {
  return (
    <div
      class="ui-inline"
      data-wrap={props.wrap ? '' : undefined}
      data-spread={props.spread ? '' : undefined}
      style={{ '--kit-gap': roleVar('space', props.gap ?? 'inline') }}
    >
      {props.children}
    </div>
  )
}
