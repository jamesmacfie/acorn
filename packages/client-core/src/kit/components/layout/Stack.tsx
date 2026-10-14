import type { JSX } from 'solid-js'
import type { StackProps } from '@acorn/protocol/tree/nodes.ts'
import { roleVar } from '../../tokens/roles'

/* Stack: children in sequence, one per line, separated by a space role, in place of a raw grouping
   `div`.

   At 80×24: children on successive lines, the gap as blank lines. */
export function Stack(props: StackProps<JSX.Element>) {
  return (
    <div
      class="ui-stack"
      data-grow={props.grow ? '' : undefined}
      style={{ '--kit-gap': roleVar('space', props.gap ?? 'stack') }}
    >
      {props.children}
    </div>
  )
}
