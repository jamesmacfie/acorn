import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeNativePage } from './nativePages'

let observers: Array<() => void>
let frames: Map<number, FrameRequestCallback>
let next: number
let dispose: (() => void) | undefined
const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} })
const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(0)) }

beforeEach(() => {
  observers = []; frames = new Map(); next = 0
  vi.stubGlobal('ResizeObserver', class {
    constructor(fn: () => void) { observers.push(fn) }
    observe() {} disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++next, fn); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  document.body.innerHTML = '<div id="root"><div id="page"></div></div>'
  document.getElementById('root')!.getBoundingClientRect = () => bounds(0, 0, 900, 700)
  document.getElementById('page')!.getBoundingClientRect = () => bounds(100, 100, 600, 400)
})
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; delete window.acorn; vi.unstubAllGlobals() })

const surface = (className: string, passive = false) => {
  const element = document.createElement('div')
  element.className = className
  if (passive) element.style.pointerEvents = 'none'
  element.getBoundingClientRect = () => bounds(90, 90, 100, 30)
  document.body.append(element)
  return element
}

describe('native page presentation', () => {
  it('centralizes fallback for partial overlaps and pointer-transparent tooltips', () => {
    const update = vi.fn()
    dispose = observeNativePage(document.getElementById('page')!, update)
    expect(update.mock.lastCall?.[1]).toBe(false)
    const tip = surface('rail-tip', true)
    observers[0](); flush()
    expect(update.mock.lastCall?.[1]).toBe(true)
    tip.remove(); observers[0](); flush()
    expect(update.mock.lastCall?.[1]).toBe(false)
  })
  it('keeps the same DOM owner, bounds, and callback while native composition is active', async () => {
    const native = vi.fn(async (_presentation: import('./index').OverlayPresentation) => true)
    window.acorn = { rendererLayer: { update: native } } as typeof window.acorn
    const update = vi.fn()
    const owner = document.getElementById('page')!
    surface('ui-popover')
    dispose = observeNativePage(owner, update)
    expect(update.mock.lastCall?.[1]).toBe(false)
    expect(document.getElementById('page')).toBe(owner)
    expect(document.getElementById('root')!.style.clipPath).toContain('evenodd')
    expect(native.mock.lastCall?.[0].surfaces[0].role).toBe('popover')
    dispose(); dispose = undefined
    await Promise.resolve()
    expect(document.getElementById('root')!.style.clipPath).toBe('')
    expect(native.mock.lastCall?.[0].pages).toEqual([])
    expect(frames.size).toBe(0)
  })
  it('restores a portal paint box and rejects late failure after owner disposal', async () => {
    let fail: ((ready: boolean) => void) | undefined
    const native = vi.fn((p: import('./index').OverlayPresentation) => p.pages.length
      ? new Promise<boolean>((resolve) => { fail = resolve }) : Promise.resolve(true))
    window.acorn = { rendererLayer: { update: native } } as typeof window.acorn
    const root = document.getElementById('root')!
    root.style.display = 'contents'
    dispose = observeNativePage(document.getElementById('page')!, vi.fn())
    expect(root.style.display).toBe('block')
    dispose(); dispose = undefined
    fail?.(false)
    await Promise.resolve()
    expect(root.style.display).toBe('contents')
    expect(root.style.height).toBe('')
    expect(frames.size).toBe(0)
    expect(native.mock.calls).toHaveLength(2)
    expect(native.mock.calls[1][0].generation).toBeGreaterThan(native.mock.calls[0][0].generation)
  })
  it('releases native input regions before switching to overlap fallback', async () => {
    const native = vi.fn(async (p: import('./index').OverlayPresentation) => !p.pages.length)
    window.acorn = { rendererLayer: { update: native } } as typeof window.acorn
    surface('rail-tip', true)
    const update = vi.fn()
    dispose = observeNativePage(document.getElementById('page')!, update)
    await Promise.resolve(); flush()
    expect(native.mock.lastCall?.[0].pages).toEqual([])
    expect(update.mock.lastCall?.[1]).toBe(true)
    expect(document.getElementById('root')!.style.clipPath).toBe('')
  })
})
