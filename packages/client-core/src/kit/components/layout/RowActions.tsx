import type { JSX } from 'solid-js'
import Icon from '../content/Icon'
import { Menu, type MenuContext } from '../overlays/Menu'
import { Button } from '../primitives'

// The per-row overflow menu: an ellipsis button that stays out of sight until you hover the row,
// focus something inside it, select it, or open the menu itself. Lifted out of the agent session
// sidebar, which had it as bespoke markup and a bespoke stylesheet rule.
//
// It carries its own reveal rather than leaning on Row's `reveal`, because a row's trailing slot
// usually holds a badge or a status as well, and those are meant to stay visible.
export function RowActions(props: {
  ariaLabel: string
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
          label={props.ariaLabel}
          opens="menu"
          expanded={open()}
          // The row underneath is usually a button or a link. Row ignores a click that landed on a
          // control inside it, so there is nothing to stop here.
          onPress={toggle}
        >
          <Icon name="ellipsis" />
        </Button>
      )}
    >
      {props.children}
    </Menu>
  )
}
