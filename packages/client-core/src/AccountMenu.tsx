import { createSignal, onCleanup, onMount, Show } from 'solid-js'

// The topbar's overflow menu. It stopped being an *account* menu when the GitHub session went away —
// there is no identity to show and nothing to log out of — but it is still where the two app-level
// actions live, so the name and the CSS stay rather than churning both for a rename.
type AccountMenuProps = {
  onSettings: () => void
  onClearCache: () => void | Promise<void>
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

  const clearCache = async () => {
    close()
    await props.onClearCache()
  }
  const settings = () => {
    close()
    props.onSettings()
  }

  return (
    <div class="account-menu" ref={rootRef}>
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
      <Show when={open()}>
        <div class="account-menu-popover" role="menu">
          <button class="account-menu-item" role="menuitem" type="button" onClick={settings}>
            Settings
          </button>
          <button class="account-menu-item" role="menuitem" type="button" onClick={clearCache}>
            Clear cache
          </button>
        </div>
      </Show>
    </div>
  )
}
