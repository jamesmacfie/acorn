import { Menu } from './ui/Menu'

// The topbar's overflow menu. It stopped being an *account* menu when the GitHub session went
// away: there is no identity to show and nothing to log out of. It is still where the two
// app-level actions live, so the name and the CSS stay rather than churning both for a rename.
//
// Dismissal, portalling, arrow-key roving and focus-return now come from Menu. This file used to
// hand-roll its own document pointerdown and keydown listeners and had no arrow keys at all.
type AccountMenuProps = {
  onSettings: () => void
  onClearCache: () => void | Promise<void>
}

export default function AccountMenu(props: AccountMenuProps) {
  return (
    <Menu
      class="account-menu-popover"
      ariaLabel="App menu"
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          class="account-menu-button"
          aria-label="App menu"
          aria-haspopup="menu"
          aria-expanded={open()}
          onClick={toggle}
        >
          <span class="account-menu-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
      )}
    >
      {(menu) => (
        <>
          <Menu.Item context={menu} onSelect={() => props.onSettings()}>Settings</Menu.Item>
          <Menu.Item context={menu} onSelect={() => void props.onClearCache()}>Clear cache</Menu.Item>
        </>
      )}
    </Menu>
  )
}
