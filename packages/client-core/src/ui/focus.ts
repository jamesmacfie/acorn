import { isTypingTarget } from '../lib/isTypingTarget'
import { setFocusedPane } from '../tasks/tasks'

export type PaneFocusOptions = { taskId: string; paneId: string }

export function paneFocus(element: HTMLElement, value: () => PaneFocusOptions): void {
  const mark = () => {
    const options = value()
    setFocusedPane(options.taskId, options.paneId)
  }
  element.addEventListener('focusin', mark)
  element.addEventListener('pointerdown', mark)
}

export const nextListIndex = (current: number, count: number, key: string): number => {
  if (count <= 0) return 0
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown' || key === 'ArrowRight' || key === 'j') return (current + 1 + count) % count
  if (key === 'ArrowUp' || key === 'ArrowLeft' || key === 'k') return (current - 1 + count) % count
  return current
}

export function createListNavigation(options: {
  count: () => number
  active: () => number
  setActive: (index: number) => void
}) {
  return (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    const next = nextListIndex(options.active(), options.count(), event.key)
    if (next === options.active()) return
    event.preventDefault()
    options.setActive(next)
  }
}

export function trapOverlayFocus(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== 'Tab') return
  const focusable = [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      paneFocus: PaneFocusOptions
    }
  }
}
