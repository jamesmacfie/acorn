import { afterEach, describe, expect, it } from 'vitest'
import { visibleElementRect } from './webviewGeometry'

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
})

const place = (element: Element, value: DOMRect): void => {
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => value })
}

const viewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

afterEach(() => document.body.replaceChildren())

describe('visibleElementRect', () => {
  it('keeps a fully visible element unchanged', () => {
    viewport(1_000, 700)
    const element = document.createElement('div')
    document.body.append(element)
    place(element, rect(120, 80, 400, 300))

    expect(visibleElementRect(element)).toEqual({ x: 120, y: 80, width: 400, height: 300 })
  })

  it('clips both axes through nested overflow ancestors', () => {
    viewport(1_000, 700)
    const horizontal = document.createElement('div')
    const vertical = document.createElement('div')
    const element = document.createElement('div')
    horizontal.style.overflowX = 'auto'
    vertical.style.overflowY = 'hidden'
    horizontal.append(vertical)
    vertical.append(element)
    document.body.append(horizontal)
    place(horizontal, rect(100, 0, 500, 700))
    place(vertical, rect(0, 50, 1_000, 400))
    place(element, rect(20, 20, 700, 500))

    expect(visibleElementRect(element)).toEqual({ x: 100, y: 50, width: 500, height: 400 })
  })

  it('clips to the viewport and returns zero area when the element is outside it', () => {
    viewport(800, 600)
    const partial = document.createElement('div')
    const outside = document.createElement('div')
    document.body.append(partial, outside)
    place(partial, rect(760, 570, 100, 100))
    place(outside, rect(-200, 100, 100, 100))

    expect(visibleElementRect(partial)).toEqual({ x: 760, y: 570, width: 40, height: 30 })
    expect(visibleElementRect(outside)).toEqual({ x: 0, y: 100, width: 0, height: 100 })
  })
})
