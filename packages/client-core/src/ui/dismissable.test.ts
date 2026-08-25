import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDismissable } from './dismissable'

// Node environment, no jsdom (see vitest.config.ts), so the focus-trap case uses the same
// hand-rolled fakes as palette/overlay.test.ts rather than pulling in a DOM implementation.
const keyEvent = (k: string, shiftKey = false) => {
  const preventDefault = vi.fn()
  return { event: { key: k, shiftKey, preventDefault } as unknown as KeyboardEvent, preventDefault }
}

const focusable = () => ({ focus: vi.fn(), hidden: false, getAttribute: () => null })

// Stands in for the document the overlay listens on, and hands back the Escape listeners it took.
const fakeDocument = (extra: Record<string, unknown> = {}) => {
  const listeners: Array<(event: KeyboardEvent) => void> = []
  Reflect.set(globalThis, 'document', {
    ...extra,
    addEventListener: (_: string, fn: (event: KeyboardEvent) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (event: KeyboardEvent) => void) => listeners.splice(listeners.indexOf(fn), 1),
  })
  return (event: KeyboardEvent) => listeners.slice().forEach((fn) => fn(event))
}

const mounted = () => ({ isConnected: true }) as unknown as HTMLElement

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
    fakeDocument({ activeElement: last })

    const { event, preventDefault } = keyEvent('Tab')
    createDismissable({ onDismiss: vi.fn(), container: () => root }).onKeyDown(event)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(first.focus).toHaveBeenCalledOnce()
  })

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    const first = focusable()
    const last = focusable()
    const root = { querySelectorAll: () => [first, last] } as unknown as HTMLElement
    fakeDocument({ activeElement: first })

    createDismissable({ onDismiss: vi.fn(), container: () => root }).onKeyDown(keyEvent('Tab', true).event)
    expect(last.focus).toHaveBeenCalledOnce()
  })

  it('dismisses on Escape pressed outside the dialog, topmost overlay first', () => {
    const press = fakeDocument()
    const outer = vi.fn()
    const inner = vi.fn()
    createRoot((dispose) => {
      createDismissable({ onDismiss: outer, container: () => mounted(), trapFocus: false })
      createDismissable({ onDismiss: inner, container: () => mounted(), trapFocus: false })
      press(keyEvent('Escape').event)
      expect(inner).toHaveBeenCalledOnce()
      expect(outer).not.toHaveBeenCalled()
      dispose()
    })
  })

  it('leaves Escape alone once the dialog is gone', () => {
    const press = fakeDocument()
    const onDismiss = vi.fn()
    createRoot((dispose) => {
      createDismissable({ onDismiss, container: () => ({ isConnected: false }) as unknown as HTMLElement, trapFocus: false })
      press(keyEvent('Escape').event)
      expect(onDismiss).not.toHaveBeenCalled()
      dispose()
    })
  })

  it('does not trap when no container is supplied', () => {
    const { event, preventDefault } = keyEvent('Tab')
    createDismissable({ onDismiss: vi.fn() }).onKeyDown(event)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
