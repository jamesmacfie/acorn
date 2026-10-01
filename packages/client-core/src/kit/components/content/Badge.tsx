import type { JSX } from 'solid-js'
import type { Size, Tone } from '../../tokens/tokens'

/* Badge. See docs/ui-design.md for `shape`. `dashed` exists for the Database example-picker's
   "add" chip, the one non-solid border in the codebase. */
export function Badge(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  shape?: 'tag' | 'pill'
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  children: JSX.Element
}) {
  return (
    <span
      class="ui-badge"
      data-tone={props.tone ?? 'neutral'}
      data-shape={props.shape ?? 'tag'}
      data-size={props.size ?? 'sm'}
      data-dashed={props.dashed ? '' : undefined}
    >
      {props.children}
    </span>
  )
}
