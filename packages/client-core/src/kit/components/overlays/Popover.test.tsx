import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Select } from '../primitives'
import Popover from './Popover'

let dispose: (() => void) | undefined
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const surface of document.querySelectorAll('.ui-popover')) surface.remove()
})

const press = (element: Element) => {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  ;(element as HTMLElement).click()
}

describe('a Select inside a Popover', () => {
  it('picks a row without the popover closing under it', () => {
    const onChange = vi.fn()
    dispose = render(() => (
      <Popover trigger={({ toggle }) => <button type="button" onClick={toggle}>open</button>}>
        <Select
          title="Model"
          value="a"
          options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
          onChange={onChange}
        />
      </Popover>
    ), host)

    press(host.querySelector('button')!)
    const surface = document.querySelector('.ui-popover')
    expect(surface).toBeTruthy()

    press(surface!.querySelector('button.ui-select')!)
    const row = [...document.querySelectorAll<HTMLButtonElement>('.ui-select-list .ui-menu-item')]
      .find((item) => item.dataset.value === 'b')
    expect(row).toBeTruthy()

    press(row!)
    expect(onChange).toHaveBeenCalledWith('b')
    // And the popover is still open: only the list it held was dismissed.
    expect(document.querySelector('.ui-popover')).toBeTruthy()
  })

  it('still closes on a press that is outside both of them', () => {
    dispose = render(() => (
      <Popover trigger={({ toggle }) => <button type="button" onClick={toggle}>open</button>}>
        <Select title="Model" value="a" options={[{ value: 'a', label: 'A' }]} />
      </Popover>
    ), host)

    press(host.querySelector('button')!)
    press(document.querySelector('.ui-popover')!.querySelector('button.ui-select')!)
    expect(document.querySelector('.ui-select-list')).toBeTruthy()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector('.ui-popover')).toBe(null)
  })
  it('dismisses a nested list with Escape before its parent popover', () => {
    dispose = render(() => (
      <Popover trigger={({ toggle }) => <button type="button" onClick={toggle}>open</button>}>
        <Select title="Model" value="a" options={[{ value: 'a', label: 'A' }]} />
      </Popover>
    ), host)
    press(host.querySelector('button')!)
    press(document.querySelector('.ui-popover')!.querySelector('button.ui-select')!)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.querySelector('.ui-select-list')).toBe(null)
    expect(document.querySelector('.ui-popover')).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.querySelector('.ui-popover')).toBe(null)
  })

})
