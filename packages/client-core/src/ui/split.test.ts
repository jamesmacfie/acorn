import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it } from 'vitest'
import { createSplitDrag } from './split'

// This package has no DOM env by design, but the hook renders nothing and touches only four APIs, so
// faking them is cheap — and worth it: a drag that ends without `pointerup` used to leave
// `user-select: none` on the body, which makes the whole app unselectable for the rest of the session.

type Listener = () => void

class FakeTarget {
  listeners: Record<string, Listener[]> = {}
  setPointerCapture() {}
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn) }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((listener) => listener !== fn)
  }
  fire(type: string) { [...(this.listeners[type] ?? [])].forEach((listener) => listener()) }
  count(type: string) { return (this.listeners[type] ?? []).length }
}

function stub() {
  const props = new Map<string, string>()
  const style = {
    get userSelect() { return props.get('user-select') ?? '' },
    set userSelect(value: string) { props.set('user-select', value) },
    removeProperty: (name: string) => void props.delete(name),
  }
  const handle = new FakeTarget()
  const win = new FakeTarget()
  Object.assign(globalThis, {
    HTMLElement: FakeTarget,
    document: { body: { style } },
    window: win,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
  })
  return { style, handle, win }
}

const GLOBALS = ['HTMLElement', 'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame']
afterEach(() => GLOBALS.forEach((key) => delete (globalThis as Record<string, unknown>)[key]))

function startDrag(handle: FakeTarget, onCommit?: () => void) {
  const drag = createRoot(() => createSplitDrag({ axis: 'x', label: 'Resize', onDelta: () => undefined, onCommit }))
  drag.handleProps.onPointerDown({
    preventDefault: () => undefined,
    currentTarget: handle,
    pointerId: 7,
    clientX: 0,
    clientY: 0,
  } as unknown as PointerEvent)
}

describe('splitter drag teardown', () => {
  it('suppresses selection during the drag and restores it on pointerup', () => {
    const { style, handle, win } = stub()
    startDrag(handle)
    expect(style.userSelect).toBe('none')
    win.fire('pointerup')
    expect(style.userSelect).toBe('')
    expect(win.count('pointermove')).toBe(0)
  })

  it('restores selection when the gesture is cancelled instead of released', () => {
    const { style, handle, win } = stub()
    startDrag(handle)
    win.fire('pointercancel')
    expect(style.userSelect).toBe('')
  })

  it('restores selection when the handle loses pointer capture mid-drag', () => {
    const { style, handle } = stub()
    startDrag(handle)
    handle.fire('lostpointercapture')
    expect(style.userSelect).toBe('')
  })

  it('commits once even when several end events arrive', () => {
    const { handle, win } = stub()
    let commits = 0
    startDrag(handle, () => commits++)
    win.fire('pointerup')
    win.fire('pointercancel')
    handle.fire('lostpointercapture')
    expect(commits).toBe(1)
  })
})
