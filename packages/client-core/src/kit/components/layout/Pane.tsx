import type { JSX } from 'solid-js'
import type { PaneProps } from '@acorn/protocol/tree/nodes.ts'
import { roleVar } from '../../tokens/roles'

/** Fill a region and give its body the space left by the header, tabs, and footer. */
export function Pane(props: PaneProps<JSX.Element>) {
  return (
    <div class="ui-pane" style={{ '--kit-gap': roleVar('space', props.gap ?? 'stack') }}>
      {props.children}
    </div>
  )
}
