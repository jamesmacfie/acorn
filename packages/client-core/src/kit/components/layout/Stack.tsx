import type { JSX } from 'solid-js'
import { roleVar } from '../../tokens/roles'
import type { Space } from '../../tokens/tokens'

/* Stack: children in sequence, one per line, separated by a space role. The raw `div` grouping
   every pane wrote for itself, named once.

   At 80×24: children on successive lines, the gap as blank lines. */
export function Stack(props: { gap?: Space; children: JSX.Element }) {
  return (
    <div class="ui-stack" style={{ '--kit-gap': roleVar('space', props.gap ?? 'stack') }}>
      {props.children}
    </div>
  )
}
