import type { JSX } from 'solid-js'
import Icon from './Icon'
import { Menu, type MenuContext } from './Menu'
import { Button } from './primitives'
import { cx } from './cx'

// The per-row overflow menu: an ellipsis button that stays out of sight until you hover the row,
// focus something inside it, select it, or open the menu itself. Lifted out of the agent session
// sidebar, which had it as bespoke markup and a bespoke stylesheet rule.
//
// It carries its own reveal rather than leaning on Row's `reveal`, because a row's trailing slot
// usually holds a badge or a status as well, and those are meant to stay visible.
export function RowActions(props: {
  ariaLabel: string
  class?: string
  children: (menu: MenuContext) => JSX.Element
}) {
  return (
    <Menu
      ariaLabel={props.ariaLabel}
      placement="bottom-end"
      trigger={({ toggle, open }) => (
        <Button
          variant="bare"
          size="sm"
          iconOnly
          class={cx('ui-row-actions', props.class)}
          aria-label={props.ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open()}
          // The row is usually a button or a link itself; without this, opening the menu also
          // activates whatever sits underneath it.
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
            toggle()
          }}
        >
          <Icon name="ellipsis" />
        </Button>
      )}
    >
      {props.children}
    </Menu>
  )
}
