// Touch has no right-click. This sends the `contextmenu` event a right-click would send when a finger
// rests on something for HOLD_MS, so every menu already wired to that event opens on a phone without
// knowing about touch.

const HOLD_MS = 500
// How far a finger may drift and still count as resting. A tap moves a few pixels on its own.
const DRIFT_PX = 10

/** Listens on `doc` until the returned function is called. */
export function installLongPressMenu(doc: Document = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { x: number; y: number } | undefined
  // A menu has opened for the touch in progress, from our timer or from the platform's own event.
  let opened = false
  // The event this file is dispatching, which its own listener must let through.
  let sending = false

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    start = undefined
  }

  const onPointerDown = (event: PointerEvent) => {
    cancel()
    opened = false
    if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return
    const { clientX, clientY, target } = event
    start = { x: clientX, y: clientY }
    timer = setTimeout(() => {
      cancel()
      opened = true
      sending = true
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
      sending = false
    }, HOLD_MS)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRIFT_PX) cancel()
  }

  // Android sends its own `contextmenu` after a long press, and whichever of the two comes second would
  // open the menu again.
  const onContextMenu = (event: MouseEvent) => {
    if (sending) return
    if (opened) {
      event.preventDefault()
      event.stopPropagation()
    } else if (timer !== undefined) {
      cancel()
      opened = true
    }
  }

  // Letting go after a long press would otherwise press whatever sits under the finger.
  const onClick = (event: MouseEvent) => {
    if (!opened) return
    opened = false
    event.preventDefault()
    event.stopPropagation()
  }

  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('pointermove', onPointerMove, true)
  doc.addEventListener('pointerup', cancel, true)
  doc.addEventListener('pointercancel', cancel, true)
  doc.addEventListener('contextmenu', onContextMenu, true)
  doc.addEventListener('click', onClick, true)
  return () => {
    cancel()
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('pointermove', onPointerMove, true)
    doc.removeEventListener('pointerup', cancel, true)
    doc.removeEventListener('pointercancel', cancel, true)
    doc.removeEventListener('contextmenu', onContextMenu, true)
    doc.removeEventListener('click', onClick, true)
  }
}
