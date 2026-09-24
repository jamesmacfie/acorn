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
