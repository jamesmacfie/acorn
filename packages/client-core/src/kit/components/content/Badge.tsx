import { createUniqueId, Show, type JSX } from 'solid-js'
import type { Size, Tone } from '../../tokens/tokens'

/* Badge. See docs/ui-design.md for `shape`. `dashed` exists for the Database example-picker's
   "add" chip, the one non-solid border in the codebase.

   A badge with a `tip` is a tab stop, the way a `Text` with one is, so a keyboard can open it. Its
   word stays its name and the tip describes it, because a badge's word ("failed") is the part a
   screen reader must not lose. */
export function Badge(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  shape?: 'tag' | 'pill'
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  /** What the word means, on hover and focus. */
  tip?: string
  children: JSX.Element
}) {
  const tipId = createUniqueId()
  return (
    <>
    <span
      class="ui-badge"
      data-tone={props.tone ?? 'neutral'}
      data-shape={props.shape ?? 'tag'}
      data-size={props.size ?? 'sm'}
      data-dashed={props.dashed ? '' : undefined}
      data-tip={props.tip}
      role={props.tip ? 'note' : undefined}
      tabindex={props.tip ? 0 : undefined}
      aria-describedby={props.tip ? tipId : undefined}
    >
      {props.children}
    </span>
    {/* Beside the badge rather than in it, so its text is still just the word. */}
    <Show when={props.tip}><span id={tipId} hidden>{props.tip}</span></Show>
    </>
  )
}
