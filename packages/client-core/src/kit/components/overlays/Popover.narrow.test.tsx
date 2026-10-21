import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Select } from '../primitives'
import Popover from './Popover'

// On a phone a popover is a sheet over a backdrop. The sheet's geometry is CSS, so what a render can
// check is that the surface drops its anchored offsets and that the backdrop owns the tap that closes.

let dispose: (() => void) | undefined
let host: HTMLElement

beforeEach(() => {
  document.documentElement.dataset.formFactor = 'narrow'
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  delete document.documentElement.dataset.formFactor
})

const press = (element: Element) => {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  ;(element as HTMLElement).click()
}

const openPopover = () => {
  dispose = render(
    () => (
      <Popover
        minWidth={300}
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle}>
            open
          </button>
        )}
      >
        <Select title="Model" value="a" options={[{ value: 'a', label: 'A' }]} />
      </Popover>
    ),
    host,
  )
  press(host.querySelector('button')!)
  return document.querySelector<HTMLElement>('.ui-popover')!
}

it('opens with no anchored position or width, over a backdrop just before it', () => {
  const surface = openPopover()
  expect(surface.style.position).toBe('fixed')
  expect(surface.style.top).toBe('')
  expect(surface.style.width).toBe('')
  expect(surface.previousElementSibling?.className).toBe('ui-sheet-backdrop')
})

it('closes on a tap on the backdrop, and takes the backdrop with it', () => {
  openPopover()
  press(document.querySelector('.ui-sheet-backdrop')!)
  expect(document.querySelector('.ui-popover')).toBe(null)
  expect(document.querySelector('.ui-sheet-backdrop')).toBe(null)
})

it('closes only the nested sheet when its own backdrop is tapped', () => {
  const surface = openPopover()
  press(surface.querySelector('button.ui-select')!)
  expect(document.querySelectorAll('.ui-sheet-backdrop')).toHaveLength(2)
  const list = document.querySelector('.ui-select-list')!
  press(list.previousElementSibling!)
  expect(document.querySelector('.ui-select-list')).toBe(null)
  expect(document.querySelector('.ui-popover')).toBeTruthy()
})

it('closes on Escape', () => {
  openPopover()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(document.querySelector('.ui-popover')).toBe(null)
  expect(document.querySelector('.ui-sheet-backdrop')).toBe(null)
})
