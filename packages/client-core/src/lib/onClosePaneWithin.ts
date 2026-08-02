import { onCleanup, onMount } from 'solid-js'

// Cmd/Ctrl+W → close the focused thing *inside* a surface. Main suppresses the window-close
// accelerator and pings the renderer (see electron.ts / preload); each subscriber acts only when
// focus is contained in its element, so the editor's file tab and the terminal drawer's session
// tab can share the chord without colliding. Call during component setup; `el` is a getter because
// refs are assigned after mount.
export function onClosePaneWithin(el: () => HTMLElement | undefined, fn: () => void): void {
  onMount(() => {
    const off = window.acorn?.onClosePane?.(() => {
      if (!el()?.contains(document.activeElement)) return
      fn()
    })
    onCleanup(() => off?.())
  })
}
