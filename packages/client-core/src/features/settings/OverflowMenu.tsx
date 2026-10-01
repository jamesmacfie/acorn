import { Menu } from '../../kit/components/overlays/Menu'
import { IconButton } from '../../kit/components/inputs/IconButton'

// The topbar's overflow menu. It stopped being an *account* menu when the GitHub session went
// away: there is no identity to show and nothing to log out of. It is still where the app-level
// actions live. Its trigger is the kit's `menu` mark, ghost like the bell beside it.
//
// Dismissal, portalling, arrow-key roving and focus-return come from Menu.
type OverflowMenuProps = {
  onSettings: () => void
  onClearCache: () => void | Promise<void>
}

export default function OverflowMenu(props: OverflowMenuProps) {
  return (
    <Menu
      ariaLabel="App menu"
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <IconButton icon="menu" label="App menu" variant="ghost" opens="menu" expanded={open()} onPress={toggle} />
      )}
    >
      {(menu) => (
        <>
          <Menu.Item context={menu} onSelect={() => props.onSettings()}>Settings</Menu.Item>
          <Menu.Separator />
          <Menu.Item context={menu} onSelect={() => void props.onClearCache()}>Clear cache</Menu.Item>
          {/* ponytail: a plain reload, no prop threaded through — the host has nothing to add to it. */}
          <Menu.Item context={menu} onSelect={() => window.location.reload()}>Reload window</Menu.Item>
        </>
      )}
    </Menu>
  )
}
