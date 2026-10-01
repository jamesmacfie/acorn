import type { JSX } from 'solid-js'
import type { Size } from '../../tokens/tokens'

/* Kbd: a key cap. Its height is fixed and the glyph centred, so a cap cannot grow the line-height
   of the row it sits in. */
export function Kbd(props: { size?: Extract<Size, 'xs' | 'sm'>; children: JSX.Element }) {
  return <kbd class="ui-kbd" data-size={props.size ?? 'sm'}>{props.children}</kbd>
}
