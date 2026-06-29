import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { Me } from './queries'

type AccountMenuProps = {
  user: Me
  onShortcuts: () => void
  onIntegrations: () => void
  onPermissions: () => void | Promise<void>
  onClearCache: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

export default function AccountMenu(props: AccountMenuProps) {
  const [open, setOpen] = createSignal(false)
  let rootRef: HTMLDivElement | undefined

  const close = () => setOpen(false)
  const toggle = () => setOpen((v) => !v)

  const onDocPointer = (e: PointerEvent) => {
    if (open() && rootRef && !rootRef.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open()) {
      e.preventDefault()
      close()
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', onDocPointer)
    window.addEventListener('keydown', onKey)
  })
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDocPointer)
    window.removeEventListener('keydown', onKey)
  })

  const logout = async () => {
    close()
    await props.onLogout()
  }
  const permissions = async () => {
    close()
    await props.onPermissions()
  }
  const clearCache = async () => {
    close()
    await props.onClearCache()
  }
  const shortcuts = () => {
    close()
    props.onShortcuts()
  }
  const integrations = () => {
    close()
    props.onIntegrations()
  }

  return (
    <div class="account-menu" ref={rootRef}>
      <button
        type="button"
        class="account-menu-button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={toggle}
      >
        <img class="avatar" src={props.user.avatar} alt={props.user.login} width="22" height="22" />
        <span class="account-menu-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <Show when={open()}>
        <div class="account-menu-popover" role="menu">
          <div class="account-menu-user" title={props.user.login}>
            {props.user.login}
          </div>
          <button class="account-menu-item" role="menuitem" type="button" onClick={shortcuts}>
            Shortcuts
          </button>
          <button class="account-menu-item" role="menuitem" type="button" onClick={integrations}>
            Integrations
          </button>
          <button class="account-menu-item" role="menuitem" type="button" onClick={permissions}>
            Permissions
          </button>
          <button class="account-menu-item" role="menuitem" type="button" onClick={clearCache}>
            Clear cache
          </button>
          <button class="account-menu-item" role="menuitem" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </Show>
    </div>
  )
}
