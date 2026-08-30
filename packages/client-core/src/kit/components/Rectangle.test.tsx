import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { Rectangle } from './Rectangle'

// The box the kit owns and something else fills with pixels (docs/ui-design.md § The closed kit).
//
// What is worth a test is not the box, it is the way out of it. A PTY and a webview both swallow Tab,
// so without a contract a reader who lands in one is stuck there — which is what the two hand-rolled
// terminal hosts did before this node existed. One stop from outside, Enter hands the keys over,
// Escape takes them back.

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

const draw = () => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <Rectangle kind="pty" label="Terminal">
      <textarea />
    </Rectangle>
  ), host)
  return {
    box: host.querySelector<HTMLElement>('.ui-rect')!,
    inner: host.querySelector<HTMLTextAreaElement>('textarea')!,
  }
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

const press = (element: HTMLElement, key: string, target: HTMLElement = element) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('Rectangle', () => {
  it('is one tab stop from outside, and names itself', () => {
    const { box } = draw()
    expect(box.getAttribute('tabindex')).toBe('0')
    expect(box.getAttribute('role')).toBe('group')
    expect(box.getAttribute('aria-label')).toBe('Terminal')
  })

  it('hands the keys to what is inside on Enter, and leaves the stop behind', () => {
    const { box, inner } = draw()
    box.focus()
    press(box, 'Enter')
    expect(document.activeElement).toBe(inner)
    // No longer a stop of its own: the reader is inside, and Tab is the surface's now.
    expect(box.getAttribute('tabindex')).toBe('-1')
  })

  it('takes them back on Escape', () => {
    const { box, inner } = draw()
    box.focus()
    press(box, 'Enter')
    press(box, 'Escape', inner)
    expect(document.activeElement).toBe(box)
    expect(box.getAttribute('tabindex')).toBe('0')
  })

  it('leaves Escape alone while nobody is inside, so a modal above it still closes', () => {
    const { box } = draw()
    box.focus()
    expect(press(box, 'Escape').defaultPrevented).toBe(false)
  })
})
