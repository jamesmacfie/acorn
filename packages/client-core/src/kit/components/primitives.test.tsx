import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Card } from './primitives'

// Card's `focus` is a navigation command, spent on the rising edge and not replayed. A pane derives it
// from a row it rebuilds on every streamed event, so the prop is re-notified while its value stays true.
// Re-running the reveal then would yank the reader back to the card and take the caret out of whatever
// they were typing (docs/future/scoll_fix.md § Repeated focus commands).

let dispose: (() => void) | undefined
let host: HTMLElement

beforeEach(() => {
  // jsdom has no layout, so the reveal's scrollIntoView is a no-op here; the focus half is what matters.
  HTMLElement.prototype.scrollIntoView = () => {}
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

describe('Card reveal', () => {
  it('reveals once and does not steal focus back when its row is rebuilt with focus still set', () => {
    const [row, setRow] = createSignal({ focused: true })
    dispose = render(() => (
      <>
        <Card focus={row().focused}>card</Card>
        <button type="button">elsewhere</button>
      </>
    ), host)
    const card = host.querySelector('.ui-card') as HTMLElement
    expect(document.activeElement).toBe(card)

    // The reader moves to another control and starts typing there.
    const button = host.querySelector('button') as HTMLButtonElement
    button.focus()
    expect(document.activeElement).toBe(button)

    // A streamed update replaces the row object; `focused` is still true. The effect is re-notified but
    // the command was already spent, so the caret stays where the reader put it.
    setRow({ focused: true })
    expect(document.activeElement).toBe(button)
  })

  it('reveals again once focus goes false and true', () => {
    const [focused, setFocused] = createSignal(true)
    dispose = render(() => (
      <>
        <Card focus={focused()}>card</Card>
        <button type="button">elsewhere</button>
      </>
    ), host)
    const card = host.querySelector('.ui-card') as HTMLElement
    const button = host.querySelector('button') as HTMLButtonElement
    button.focus()

    // A fresh navigation to the same card: focus drops and rises again, and the reveal fires once more.
    setFocused(false)
    setFocused(true)
    expect(document.activeElement).toBe(card)
  })
})
