import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDismissable } from './dismissable'

// Node environment, no jsdom (see vitest.config.ts), so the focus-trap case uses the same
// hand-rolled fakes as palette/overlay.test.ts rather than pulling in a DOM implementation.
const keyEvent = (k: string, shiftKey = false) => {
  const preventDefault = vi.fn()
  return { event: { key: k, shiftKey, preventDefault } as unknown as KeyboardEvent, preventDefault }
}

const focusable = () => ({ focus: vi.fn(), hidden: false, getAttribute: () => null })

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
})

describe('createDismissable', () => {
  it('dismisses on Escape', () => {
    const onDismiss = vi.fn()
    const { event, preventDefault } = keyEvent('Escape')
    createDismissable({ onDismiss }).onKeyDown(event)
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('dismisses on backdrop click', () => {
    const onDismiss = vi.fn()
    createDismissable({ onDismiss }).onBackdropClick()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('does not dismiss on a click inside the dialog', () => {
    const onDismiss = vi.fn()
    const stopPropagation = vi.fn()
    createDismissable({ onDismiss }).onContainerClick({ stopPropagation } as unknown as MouseEvent)
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('honours an opt-out of a gesture', () => {
    const onDismiss = vi.fn()
    const d = createDismissable({ onDismiss, on: ['escape'] })
    d.onBackdropClick()
    expect(onDismiss).not.toHaveBeenCalled()
    d.onKeyDown(keyEvent('Escape').event)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('ignores unrelated keys', () => {
    const onDismiss = vi.fn()
    createDismissable({ onDismiss }).onKeyDown(keyEvent('a').event)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('wraps Tab from the last focusable back to the first', () => {
    const first = focusable()
    const last = focusable()
    const root = { querySelectorAll: () => [first, last] } as unknown as HTMLElement
    Reflect.set(globalThis, 'document', { activeElement: last })

    const { event, preventDefault } = keyEvent('Tab')
    createDismissable({ onDismiss: vi.fn(), container: () => root }).onKeyDown(event)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(first.focus).toHaveBeenCalledOnce()
  })

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    const first = focusable()
    const last = focusable()
    const root = { querySelectorAll: () => [first, last] } as unknown as HTMLElement
    Reflect.set(globalThis, 'document', { activeElement: first })

    createDismissable({ onDismiss: vi.fn(), container: () => root }).onKeyDown(keyEvent('Tab', true).event)
    expect(last.focus).toHaveBeenCalledOnce()
  })

  it('does not trap when no container is supplied', () => {
    const { event, preventDefault } = keyEvent('Tab')
    createDismissable({ onDismiss: vi.fn() }).onKeyDown(event)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
