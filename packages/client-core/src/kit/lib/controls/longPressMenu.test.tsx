import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLongPressMenu } from './longPressMenu'

let row: HTMLElement
let uninstall: () => void
const menus = vi.fn()
const clicks = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  row = document.createElement('div')
  document.body.append(row)
  row.addEventListener('contextmenu', menus)
  row.addEventListener('click', clicks)
  uninstall = installLongPressMenu()
})

afterEach(() => {
  uninstall()
  row.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const pointer = (type: string, pointerType: string, x = 20, y = 30) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  row.dispatchEvent(event)
}

// What the browser sends when the platform itself decides a press was a long one.
const platformContextMenu = () => {
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}

describe('installLongPressMenu', () => {
  it('sends a contextmenu event at the finger after a half-second hold', () => {
    pointer('pointerdown', 'touch', 20, 30)
    vi.advanceTimersByTime(499)
    expect(menus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(menus).toHaveBeenCalledOnce()
    expect(menus.mock.calls[0]?.[0]).toMatchObject({ clientX: 20, clientY: 30 })
  })

  it('ignores a tap, a drag, and a mouse', () => {
    pointer('pointerdown', 'touch')
    vi.advanceTimersByTime(300)
    pointer('pointerup', 'touch')
    vi.advanceTimersByTime(1000)

    pointer('pointerdown', 'touch')
    pointer('pointermove', 'touch', 20, 60)
    vi.advanceTimersByTime(1000)

    pointer('pointerdown', 'mouse')
    vi.advanceTimersByTime(1000)
    expect(menus).not.toHaveBeenCalled()
  })

  it('tolerates the drift of a resting finger', () => {
    pointer('pointerdown', 'touch')
    pointer('pointermove', 'touch', 24, 34)
    vi.advanceTimersByTime(500)
    expect(menus).toHaveBeenCalledOnce()
  })

  it('swallows the platform’s own contextmenu after the timer opened one', () => {
    pointer('pointerdown', 'touch')
    vi.advanceTimersByTime(500)
    platformContextMenu()
    expect(menus).toHaveBeenCalledOnce()
  })

  it('opens once when the platform’s contextmenu comes first', () => {
    pointer('pointerdown', 'touch')
    vi.advanceTimersByTime(400)
    platformContextMenu()
    vi.advanceTimersByTime(1000)
    expect(menus).toHaveBeenCalledOnce()
  })

  it('leaves a right-click alone', () => {
    pointer('pointerdown', 'mouse')
    platformContextMenu()
    expect(menus).toHaveBeenCalledOnce()
  })

  it('does not press what lies under the finger when it lifts', () => {
    pointer('pointerdown', 'touch')
    vi.advanceTimersByTime(500)
    pointer('pointerup', 'touch')
    row.click()
    expect(clicks).not.toHaveBeenCalled()
    row.click()
    expect(clicks).toHaveBeenCalledOnce()
  })
})
