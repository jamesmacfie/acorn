import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CopyButton from './CopyButton'

// Two things a plugin tree needs from this button, and neither was there before it had to serve one.
//
// A tree sends JSON over a message port, so `text` arrives as a string; a function survives that trip
// only under one of the eleven kit event names (protocol/tree/nodes.ts § KIT_EVENTS). And the kit
// takes no class, so a tree cannot put the `.copyable` on an ancestor that the hover reveal keys off,
// which is what `always` answers.

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

const draw = (element: () => ReturnType<typeof CopyButton>) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(element, host)
  return host.querySelector<HTMLButtonElement>('.copy-btn')!
}

afterEach(() => {
  dispose?.()
  host?.remove()
})

describe('CopyButton', () => {
  it('copies a plain string', () => {
    const onCopy = vi.fn()
    draw(() => <CopyButton text="james/fast-6323" onCopy={onCopy} />).click()
    expect(onCopy).toHaveBeenCalledWith('james/fast-6323')
  })

  it('reads an accessor at click time rather than at render', () => {
    let live = 'first'
    const onCopy = vi.fn()
    const button = draw(() => <CopyButton text={() => live} onCopy={onCopy} />)
    live = 'second'
    button.click()
    expect(onCopy).toHaveBeenCalledWith('second')
  })

  it('marks itself always-visible only when asked', () => {
    expect(draw(() => <CopyButton text="x" />).dataset.always).toBeUndefined()
    dispose?.()
    host?.remove()
    expect(draw(() => <CopyButton text="x" always />).dataset.always).toBe('')
  })
})
