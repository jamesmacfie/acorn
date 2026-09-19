import { splitProps } from 'solid-js'
import Icon from '../content/Icon'
import { Button, type ButtonProps } from '../primitives'

/** IconButton: a button whose whole face is one mark. The small square affordance that sits in a
 *  bar, on a row, or beside a field — go to top, collapse all, refresh, close.
 *
 *  It exists because the three props that make one were written out at sixty call sites, and seven
 *  of them had lost the `size` along the way and drew a third larger than the rest. The defaults are
 *  `bare` and `sm`, which is what the agents pane's transcript controls take; a caller that wants
 *  the dashboards' smaller `ghost`/`xs` pair still says so.
 *
 *  `label` is required rather than optional, which is the other half of the reason. A glyph has no
 *  text in it, so a button whose only child is a mark reads as nothing at all to a screen reader —
 *  the browser preview's back button announced itself as "‹" — and the terminal host, which draws
 *  the words instead of the mark, had nothing to print (apps/tui/src/kit/asking.tsx). */
export function IconButton(props: Omit<ButtonProps, 'children' | 'iconOnly' | 'label'> & {
  /** The mark, by the same name `Icon` takes: a Lucide name, or `brand:` and a registered one. */
  icon: string
  /** The accessible name. What the button does, in words, because the mark cannot say it. */
  label: string
  /** Turns the mark, for an action that is in flight. */
  spin?: boolean
}) {
  const [own, rest] = splitProps(props, ['icon', 'spin'])
  return (
    <Button {...rest} iconOnly variant={rest.variant ?? 'bare'} size={rest.size ?? 'sm'}>
      <Icon name={own.icon} spin={own.spin} />
    </Button>
  )
}
