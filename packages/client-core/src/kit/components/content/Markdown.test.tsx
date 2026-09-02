import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Markdown from './Markdown'

// What a streaming message costs to redraw.
//
// An agent message reaches a client about 25 times a second and grows at the end. This node used to
// answer each of those by replacing its whole subtree: every paragraph re-parsed, every copy button
// re-mounted, every code fence re-tokenized — and any text the reader had selected lost. So the
// assertions here are about identity: which elements survive an update, and how many times the
// highlighter is asked.

const highlighted = vi.fn(async (code: string, _lang: string) => `<pre class="hl">${code}</pre>`)
vi.mock('../../../infra/highlight/shiki', () => ({
  highlightToHtml: (code: string, lang: string) => highlighted(code, lang),
}))

let dispose: (() => void) | undefined
let host: HTMLElement

beforeEach(() => {
  highlighted.mockClear()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const mount = (initial: string) => {
  const [text, setText] = createSignal(initial)
  dispose = render(() => <Markdown text={text()} copy />, host)
  const root = host.querySelector('.ui-markdown')
  if (!root) throw new Error('Markdown did not render a root')
  return { root, setText }
}

/** The blocks the reader can see, in order. */
const blocks = (root: Element) => [...root.children]

describe('a streaming markdown message', () => {
  it('keeps every block above the one that is growing', () => {
    const { root, setText } = mount('First paragraph.\n\nSecond para')
    const before = blocks(root)
    expect(before).toHaveLength(2)

    setText('First paragraph.\n\nSecond paragraph.')
    const after = blocks(root)
    expect(after).toHaveLength(2)
    // The same element, not an equal one: this is what a text selection is anchored to.
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1].textContent).toBe('Second paragraph.')
  })

  it('keeps them across a block boundary appearing', () => {
    const { root, setText } = mount('Intro.\n\nMiddle.')
    const before = blocks(root)

    setText('Intro.\n\nMiddle.\n\nTail.')
    const after = blocks(root)
    expect(after).toHaveLength(3)
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
  })

  it('highlights a closed fence once across ten updates', async () => {
    const fence = '```ts\nconst a = 1\n```'
    const { root, setText } = mount(`${fence}\n\nProse`)
    await vi.waitFor(() => expect(root.querySelector('pre.hl')).not.toBeNull())
    expect(highlighted).toHaveBeenCalledTimes(1)

    const fenceEl = blocks(root)[0]
    for (let at = 1; at <= 10; at++) setText(`${fence}\n\nProse${'!'.repeat(at)}`)
    await vi.waitFor(() => expect(root.lastElementChild?.textContent).toBe(`Prose${'!'.repeat(10)}`))

    // The fence's source never moved, so its element never moved and it was never re-tokenized.
    expect(highlighted).toHaveBeenCalledTimes(1)
    expect(blocks(root)[0]).toBe(fenceEl)
    expect(fenceEl.querySelector('pre.hl')).not.toBeNull()
  })

  it('mounts one copy button per fence and leaves it alone', async () => {
    const fence = '```ts\nconst a = 1\n```'
    const { root, setText } = mount(`${fence}\n\nProse`)
    await vi.waitFor(() => expect(root.querySelector('button')).not.toBeNull())
    const button = root.querySelector('button')

    setText(`${fence}\n\nProse and more`)
    expect(root.querySelectorAll('button')).toHaveLength(1)
    expect(root.querySelector('button')).toBe(button)
  })

  it('drops a block that is gone', () => {
    const { root, setText } = mount('One.\n\nTwo.\n\nThree.')
    expect(blocks(root)).toHaveLength(3)
    setText('One.')
    expect(blocks(root)).toHaveLength(1)
    expect(root.textContent).toBe('One.')
  })

  it('gives two identical blocks an element each', () => {
    const { root, setText } = mount('Same.\n\nSame.')
    const before = blocks(root)
    expect(before).toHaveLength(2)
    expect(before[0]).not.toBe(before[1])

    setText('Same.\n\nSame.\n\nOther.')
    const after = blocks(root)
    expect(after.slice(0, 2)).toEqual(before)
  })

  it('does not touch the DOM when the text has not changed', () => {
    const [text, setText] = createSignal('Steady.')
    const [unrelated, setUnrelated] = createSignal(0)
    // A prop is a getter, not a memo, so the component's effect re-runs whenever anything upstream
    // ticks. The guard on the last rendered input is what stops that from rewriting the subtree.
    dispose = render(() => <Markdown text={`${text()}${unrelated() ? '' : ''}`} />, host)
    const root = host.querySelector('.ui-markdown')!
    const before = blocks(root)[0]
    setUnrelated(1)
    expect(blocks(root)[0]).toBe(before)
    setText('Moved.')
    expect(blocks(root)[0]).not.toBe(before)
  })
})
