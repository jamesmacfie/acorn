import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installKeymap } from '../../../host/keys/install'
import { setKeymap } from '../../keys/keymapHost'
import { _resetCollectionState } from '../../keys/collectionState'
import { Row } from '../primitives'
import { Rows } from './Rows'

// A reorderable `Rows`: the order it draws while a save runs, the order it goes back to when the save
// fails, and the two ways in that are not a drag.

let disposers: (() => void)[] = []
let host: HTMLElement

beforeEach(() => {
  disposers.push(
    render(() => {
      installKeymap(document.documentElement, { prefs: () => ({ taskActive: false }), bindings: () => [] })
      return null
    }, document.createElement('div')),
  )
})

afterEach(() => {
  for (const dispose of disposers.reverse()) dispose()
  disposers = []
  setKeymap(null)
  host?.remove()
  _resetCollectionState()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const order = () => [...host.querySelectorAll<HTMLElement>('.ui-row')].map((row) => row.textContent)
const status = () => host.querySelector('[role="status"]')?.textContent

/** A list whose save the test settles by hand. `keys` is what the caller would read back on success. */
function mount(initial: string[], fixed: string[] = []) {
  const [keys, setKeys] = createSignal(initial)
  const saves: { keys: string[]; resolve: () => void; reject: () => void }[] = []
  const onReorder = (next: string[]) =>
    new Promise<void>((resolve, reject) =>
      saves.push({
        keys: next,
        resolve: () => {
          setKeys([...fixed, ...next])
          resolve()
        },
        reject: () => reject(new Error('offline')),
      }),
    )
  host = document.createElement('div')
  document.body.append(host)
  disposers.push(
    render(
      () => (
        <Rows
          id="rows-reorder-test"
          items={keys().map((key) => ({ key, label: key, ...(fixed.includes(key) ? { fixed: true } : {}) }))}
          onReorder={onReorder}
        >
          {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
        </Rows>
      ),
      host,
    ),
  )
  return saves
}

const altKey = (key: 'ArrowUp' | 'ArrowDown') => {
  const row = document.activeElement as HTMLElement
  row.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }))
}

it('draws the new order while the save runs, and keeps it once saved', async () => {
  const saves = mount(['a', 'b', 'c'])
  host.querySelector<HTMLButtonElement>('[aria-label="Reorder a"]')!.click()
  const down = [...document.querySelectorAll<HTMLElement>('.ui-menu-item')].find((item) =>
    item.textContent?.includes('Move down'),
  )!
  down.click()
  expect(saves.map((save) => save.keys)).toEqual([['b', 'a', 'c']])
  expect(order()).toEqual(['b', 'a', 'c'])
  expect(status()).toBe('Saving order…')
  // Nothing else moves while one save is in flight.
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Reorder b"]')!.disabled).toBe(true)

  saves[0]!.resolve()
  await settle()
  expect(order()).toEqual(['b', 'a', 'c'])
  expect(status()).toBe('Order saved.')
})

it('puts the old order back when the save fails', async () => {
  const saves = mount(['a', 'b', 'c'])
  host.querySelector<HTMLElement>('.ui-row')!.focus()
  altKey('ArrowDown')
  expect(order()).toEqual(['b', 'a', 'c'])

  saves[0]!.reject()
  await settle()
  expect(order()).toEqual(['a', 'b', 'c'])
  expect(status()).toBe('Order not saved.')
})

it('moves the active row with Alt+↑ and Alt+↓, and leaves a fixed row where it is', async () => {
  const saves = mount(['broken', 'a', 'b'], ['broken'])
  // A fixed row has no grip, and no key moves it or moves another row past it.
  expect(host.querySelector('[aria-label="Reorder broken"]')).toBeNull()
  const rows = () => [...host.querySelectorAll<HTMLElement>('.ui-row')]
  rows()[0]!.focus()
  altKey('ArrowDown')
  rows()[1]!.focus()
  altKey('ArrowUp')
  expect(saves).toEqual([])

  altKey('ArrowDown')
  expect(saves.map((save) => save.keys)).toEqual([['b', 'a']])
  saves[0]!.resolve()
  await settle()
  expect(order()).toEqual(['broken', 'b', 'a'])
  // Focus follows the row that moved, so a second press moves it again.
  expect(document.activeElement?.textContent).toBe('a')
})
