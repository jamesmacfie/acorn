// A native child webview is a sibling of the renderer webview, not a descendant of the DOM element
// whose pixels it replaces. CSS overflow therefore cannot clip it. Convert that element's box into
// the part its clipping ancestors and the viewport actually expose before the shell positions the
// native surface.

export type VisibleElementRect = {
  x: number
  y: number
  width: number
  height: number
}

const CLIPPING_OVERFLOW = new Set(['auto', 'clip', 'hidden', 'scroll'])

const clips = (value: string): boolean => CLIPPING_OVERFLOW.has(value)

export function visibleElementRect(element: Element): VisibleElementRect {
  const bounds = element.getBoundingClientRect()
  let left = Math.max(0, bounds.left)
  let top = Math.max(0, bounds.top)
  let right = Math.min(window.innerWidth, bounds.right)
  let bottom = Math.min(window.innerHeight, bounds.bottom)

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent)
    const clipX = clips(style.overflowX)
    const clipY = clips(style.overflowY)
    if (!clipX && !clipY) continue

    const parentBounds = parent.getBoundingClientRect()
    if (clipX) {
      left = Math.max(left, parentBounds.left)
      right = Math.min(right, parentBounds.right)
    }
    if (clipY) {
      top = Math.max(top, parentBounds.top)
      bottom = Math.min(bottom, parentBounds.bottom)
    }
  }

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export const elementRectKey = (rect: VisibleElementRect): string =>
  `${rect.x},${rect.y},${rect.width},${rect.height}`
