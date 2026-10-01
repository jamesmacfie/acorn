import { afterEach, expect, it, vi } from 'vitest'
import { mountFrameTips } from './frameTips'

let cleanup = () => {}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('shows a fresh relative age in an isolated plugin frame', () => {
  const at = Date.parse('2026-09-25T03:24:18Z')
  const off = mountFrameTips(document)
  const trigger = document.createElement('span')
  trigger.dataset.tip = 'Local time with zone'
  trigger.dataset.tipAt = String(at)
  document.body.append(trigger)
  cleanup = () => { off(); trigger.remove() }

  vi.spyOn(Date, 'now').mockReturnValue(at + 5 * 60_000)
  trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(document.querySelector('.rail-tip-sub')?.textContent).toBe('5m ago')
})

it('marks a help tip, so the frame draws it as a help bubble', () => {
  const off = mountFrameTips(document)
  const trigger = document.createElement('button')
  trigger.dataset.tip = 'Why this exists'
  trigger.dataset.tipKind = 'help'
  document.body.append(trigger)
  cleanup = () => { off(); trigger.remove() }

  trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(document.querySelector<HTMLElement>('.rail-tip')?.dataset.kind).toBe('help')
})
