// What is left of the old focus helpers. The trap moved to `keys/trap.ts` when `Modal` and `Menu`
// started trapping through the kit; the list navigation below has one caller left
// (dashboards/DashboardTabs.tsx) and goes with this file in phase 9 of the layout programme.
import { isTypingTarget } from '../lib/isTypingTarget'

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
