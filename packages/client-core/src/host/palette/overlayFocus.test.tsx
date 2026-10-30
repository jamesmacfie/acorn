import { describe, expect, it } from 'vitest'
import { createOverlayFocus } from './overlay'

describe('overlay focus hand-back', () => {
  it('returns focus to where it was, unless the pick moved it somewhere else', () => {
    const [before, target, input] = ['button', 'button', 'input'].map((tag) =>
      document.body.appendChild(document.createElement(tag)),
    )
    const focus = createOverlayFocus(() => undefined)
    focus.setInputRef(input as HTMLInputElement)

    before.focus()
    focus.claim()
    input.focus()
    focus.release()
    expect(document.activeElement).toBe(before)

    focus.claim()
    input.focus()
    target.focus()
    focus.release()
    expect(document.activeElement).toBe(target)
    for (const element of [before, target, input]) element.remove()
  })
})
