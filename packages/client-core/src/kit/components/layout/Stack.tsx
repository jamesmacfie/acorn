import type { JSX } from 'solid-js'
import { roleVar } from '../../tokens/roles'
import type { Space } from '../../tokens/tokens'

/* Stack: children in sequence, one per line, separated by a space role. The raw `div` grouping
   every pane wrote for itself, named once.

   At 80×24: children on successive lines, the gap as blank lines. */
export function Stack(props: {
  gap?: Space
  /** This stack IS the region rather than a run of content inside one: it fills the box it was given
   *  and its children divide that, which is what lets one of them scroll or hold a canvas. The same
   *  word `Textarea` uses for the same idea. Without it a stack is as tall as what is in it, so a
   *  scroller inside it never has a height to scroll against. */
  grow?: boolean
  children: JSX.Element
}) {
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
