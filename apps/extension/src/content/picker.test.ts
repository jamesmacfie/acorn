// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PickerMessage } from '../handoffs'

// The element picker against a real DOM. The browser side is a stub: the message listener the
// background talks to. The picker draws in a closed shadow root, which the page can't reach, so the
// test keeps the root as it is attached. jsdom can only make events a page could make, which the
// picker ignores, so the person's own events go straight to the listeners the picker added.
type Listener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown
let listener: Listener | undefined
let root: ShadowRoot | undefined
const listeners = new Map<EventTarget, { type: string; listener: EventListener }[]>()

beforeEach(async () => {
  document.body.innerHTML = '<main><button class="save">Save</button><p class="other">Other</p></main>'
  root = undefined
  answers = []
  listeners.clear()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    root = attachShadow.call(this, init)
    return root
  })
  // jsdom's window has its own `addEventListener`, apart from every other target's.
  for (const target of [EventTarget.prototype, window]) {
    const addEventListener = target.addEventListener
    vi.spyOn(target, 'addEventListener').mockImplementation(function (this: EventTarget, type, added, options) {
      listeners.set(this, [...(listeners.get(this) ?? []), { type, listener: added as EventListener }])
      return addEventListener.call(this, type, added, options)
    })
  }
  const scope = globalThis as Record<string, unknown>
  delete scope.acornPicker
  scope.chrome = { runtime: { onMessage: { addListener: (added: Listener) => void (listener = added) } } }
  vi.resetModules()
  await import('./picker')
})
afterEach(() => {
  // Each test imports its own copy of the script. Escape takes away what the last one drew.
  person('keydown', document.body, { key: 'Escape' })
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).chrome
})

// What the picker answered, which tells the background it's on the page.
let answers: unknown[] = []
const pick = (mode: PickerMessage['mode']) =>
  listener?.({ type: 'acorn:pick', mode } satisfies PickerMessage, {}, (answer) => answers.push(answer))
const element = (selector: string) => document.querySelector(selector)!
const drawn = () => document.querySelector('[data-acorn-picker]')
const outline = () => root!.querySelector<HTMLElement>('.outline')!
const box = () => (drawn() ? root!.querySelector<HTMLElement>('.box') : null)

// The person's own event at `target`, delivered to the listeners the picker added on the window.
function person(type: string, target: EventTarget, extra: Record<string, unknown> = {}) {
  const event = { type, target, isTrusted: true, preventDefault() {}, stopImmediatePropagation() {}, ...extra }
  for (const added of listeners.get(window) ?? []) if (added.type === type) added.listener(event as unknown as Event)
}

describe('the element picker', () => {
  it('opens the box beside the element the person right-clicked', () => {
    person('contextmenu', element('.save'))
    expect(pick('target')).toBe(true)
    expect(answers).toEqual([true])
    expect(drawn()?.parentElement).toBe(document.documentElement)
    expect(outline().hidden).toBe(true)
    expect(box()!.getAttribute('aria-label')).toBe('Ask Acorn about this element')
    expect(box()!.dataset.theme).toBe('light')
    expect(root!.activeElement).toBe(box()!.querySelector('textarea'))
    const selects = [...box()!.querySelectorAll('select')]
    expect(selects.map((select) => [select.getAttribute('aria-label'), select.options.length])).toEqual([
      ['Conversation', 0],
      ['Agent', 0],
    ])
    expect(box()!.querySelector<HTMLButtonElement>('.send')!.disabled).toBe(true)
    expect([...box()!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Cancel', 'Send'])
  })

  it('lets the person point at an element when there is no right-click to use', () => {
    // A page can make a right-click, but not the person's.
    element('.save').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    pick('target')
    expect(box()).toBeNull()
    expect(drawn()).not.toBeNull()

    person('mouseover', element('.other'))
    expect(outline().hidden).toBe(false)
    // A click the page made picks nothing.
    element('.save').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(box()).toBeNull()
    person('click', element('.save'))
    expect(box()).not.toBeNull()
    expect(outline().hidden).toBe(true)
  })

  it('cancels the pointing, and the box, on Escape', () => {
    pick('hover')
    person('mouseover', element('.save'))
    person('keydown', document.body, { key: 'Escape' })
    expect(drawn()).toBeNull()
    // Clicks are the page's own again.
    person('click', element('.save'))
    expect(drawn()).toBeNull()

    person('contextmenu', element('.save'))
    pick('target')
    person('keydown', drawn()!, { key: 'Escape' })
    expect(drawn()).toBeNull()
  })

  it("closes the box on the person's Cancel, and when the element leaves the page", async () => {
    person('contextmenu', element('.save'))
    pick('target')
    const cancel = box()!.querySelector('.cancel')!
    // Only the person's own click.
    ;(cancel as HTMLButtonElement).click()
    expect(box()).not.toBeNull()
    for (const added of listeners.get(cancel) ?? [])
      added.listener({ isTrusted: true, preventDefault() {}, stopPropagation() {} } as unknown as Event)
    expect(drawn()).toBeNull()

    pick('target')
    element('.save').remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(drawn()).toBeNull()
  })

  it('keeps what the person types in the box out of the page', () => {
    person('contextmenu', element('.save'))
    pick('target')
    const typed = vi.fn()
    document.body.addEventListener('keydown', typed)
    box()!
      .querySelector('textarea')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }))
    expect(typed).not.toHaveBeenCalled()
  })
})
