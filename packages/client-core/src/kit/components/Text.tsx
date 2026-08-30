import type { JSX } from 'solid-js'
import type { TextRole, Tone } from '../tokens/tokens'

/* Text: a run of words with a role.

   The kit table has named this node since the layout programme was written
   (docs/ui-design.md § Every node at 80 by 24) and nothing built it, because inside the shell a `<span>`
   with a class was always to hand. A remote tree has no such thing: `class` and `style` never cross,
   so without this node a plugin's only way to say "this line is dim" is a raw element it is not
   allowed to emit. Four plugins wanted it on the first day of the move.

   Two roles rather than one prop with six values in it. `emphasis` is how the text carries — the
   weight, the family, the label treatment — and `tone` is what it means. A muted body line and a
   strong danger line are both ordinary, and neither is expressible if the two share an axis.

   At 80×24: plain text; `mono` is a no-op, `muted` is dim, `strong` and `heading` are bold, `eyebrow`
   is dim uppercase, `match` is reverse video. */
export function Text(props: {
  emphasis?: TextRole
  tone?: Tone
  /** Wrap onto more lines. Off by default, because the common case is one line in a row that
   *  truncates, and a wrapping line inside a fixed row is what breaks a list's geometry. */
  wrap?: boolean
  children: JSX.Element
}) {
  return (
    <span
      class="ui-text"
      data-emphasis={props.emphasis ?? 'body'}
      data-tone={props.tone ?? undefined}
      data-wrap={props.wrap ? '' : undefined}
    >
      {props.children}
    </span>
  )
}
