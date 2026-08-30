import { onCleanup, onMount } from 'solid-js'
import { desktopExtras } from '../../infra/platform'

// Cmd/Ctrl+W → close the focused thing *inside* a surface. The shell takes the accelerator as a menu
// item so it never closes the window, and pings the renderer; each subscriber acts only when
// focus is contained in its element, so the editor's file tab and the terminal drawer's session
// tab can share the chord without colliding. Call during component setup; `el` is a getter because
// refs are assigned after mount.
export function onClosePaneWithin(el: () => HTMLElement | undefined, fn: () => void): void {
  onMount(() => {
    const off = desktopExtras()?.onClosePane(() => {
      if (!el()?.contains(document.activeElement)) return
      fn()
    })
    onCleanup(() => off?.())
  })
}
