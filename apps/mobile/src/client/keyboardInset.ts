import { onCleanup } from 'solid-js'

/** How much of the page the on-screen keyboard covers. A phone's browser keeps the layout viewport
 *  whole and shrinks only the visual one, so the difference is the keyboard. A browser that resizes the
 *  layout viewport instead reports none, and the page already fits. */
export const keyboardInset = (layoutHeight: number, visual: { height: number; offsetTop: number }): number =>
  Math.max(0, Math.round(layoutHeight - visual.height - visual.offsetTop))

/** Keeps `--keyboard-inset` on the root element at the keyboard's height, for the shell and the sheets to
 *  subtract, and `data-keyboard` on it while the keyboard is up. The panes inside read no window: they
 *  are only given less room. */
export function trackKeyboardInset(): void {
  const visual = window.visualViewport
  if (!visual) return
  const root = document.documentElement
  const update = () => {
    const inset = keyboardInset(window.innerHeight, visual)
    root.style.setProperty('--keyboard-inset', `${inset}px`)
    root.toggleAttribute('data-keyboard', inset > 0)
  }
  update()
  visual.addEventListener('resize', update)
  visual.addEventListener('scroll', update)
  onCleanup(() => {
    visual.removeEventListener('resize', update)
    visual.removeEventListener('scroll', update)
  })
}
