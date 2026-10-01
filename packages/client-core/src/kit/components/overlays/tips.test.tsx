import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import Tips from './tips'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

it('calculates a timestamp tooltip age when the reader opens it', () => {
  const at = Date.parse('2026-09-25T03:24:18Z')
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <Tips />, host)
  cleanups.push(() => { dispose(); host.remove() })

  const trigger = document.createElement('span')
  trigger.dataset.tip = '25 Sep 2026, 3:24 PM GMT+12 · Pacific/Auckland'
  trigger.dataset.tipAt = String(at)
  document.body.append(trigger)
  cleanups.push(() => trigger.remove())

  vi.spyOn(Date, 'now').mockReturnValue(at + 8 * 60_000)
  trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(host.querySelector('.rail-tip-title')?.textContent).toContain('Pacific/Auckland')
  expect(host.querySelector('.rail-tip-sub')?.textContent).toBe('8m ago')

  trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  vi.spyOn(Date, 'now').mockReturnValue(at + 12 * 60_000)
  trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(host.querySelector('.rail-tip-sub')?.textContent).toBe('12m ago')
})

const mountTips = () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <Tips />, host)
  cleanups.push(() => { dispose(); host.remove() })
  return host
}

const trigger = (attrs: Record<string, string>, rect: Partial<DOMRect>) => {
  const element = document.createElement('button')
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value)
  element.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect
  document.body.append(element)
  cleanups.push(() => element.remove())
  return element
}

it('draws a help mark tip as a help bubble', () => {
  const host = mountTips()
  trigger({ 'data-tip': 'An idle agent can hold hundreds of megabytes.', 'data-tip-kind': 'help' }, { left: 100, right: 118, top: 100, height: 18 })
    .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(host.querySelector<HTMLElement>('.rail-tip')!.dataset.kind).toBe('help')
})

it('flips to the left of an element near the right edge, and stays inside the window', () => {
  const host = mountTips()
  // jsdom lays nothing out, so the bubble reports the size a 200 by 60 bubble would.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60)
  const right = window.innerWidth - 20
  trigger({ 'data-tip': 'Collapse all' }, { left: right - 20, right, top: window.innerHeight - 10, height: 10 })
    .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  const bubble = host.querySelector<HTMLElement>('.rail-tip')!
  expect(bubble.style.left).toBe('')
  expect(bubble.style.right).toBe(`${window.innerWidth - (right - 20) + 8}px`)
  // Its middle moves up until its bottom is a margin inside the window.
  expect(parseFloat(bubble.style.top) + 30).toBeLessThanOrEqual(window.innerHeight)
})

it('closes when the element it belongs to leaves the page, which sends no focusout', async () => {
  const host = mountTips()
  const mark = trigger({ 'data-tip': 'Why this exists', 'data-tip-kind': 'help' }, { left: 100, right: 118, top: 100, height: 18 })
  mark.focus()
  mark.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  expect(host.querySelector('.rail-tip')).not.toBeNull()
  mark.remove()
  await Promise.resolve()
  expect(host.querySelector('.rail-tip')).toBeNull()
})
