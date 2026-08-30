import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Table, TableCell, TableHead, TableRow } from './primitives'

// Table's rows as kit nodes (docs/ui-design.md § Every node at 80 by 24). Two things
// here are not obvious from reading the components: a `head` row is what `stickyHead`'s CSS pins, so
// it has to come out inside a `<thead>`; and `onPress` carries the keyboard a table row otherwise
// has no way to get, because a cell cannot be a `Row`.

let host: HTMLElement
let dispose: () => void

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

describe('the kit table', () => {
  it('puts a head row in a thead and a body row outside one', () => {
    dispose = render(() => (
      <Table stickyHead>
        <TableRow head><TableHead>Model</TableHead></TableRow>
        <TableRow><TableCell header>Sonnet</TableCell><TableCell>3</TableCell></TableRow>
      </Table>
    ), host)
    expect(host.querySelector('thead th[scope="col"]')?.textContent).toBe('Model')
    expect(host.querySelector('tbody')).toBeNull()
    const body = [...host.querySelectorAll('tr')].filter((row) => !row.closest('thead'))
    expect(body).toHaveLength(1)
    expect(body[0].querySelector('th[scope="row"]')?.textContent).toBe('Sonnet')
    expect(body[0].querySelector('td')?.textContent).toBe('3')
  })

  it('spends alignment and truncation priority as attributes, never as a length', () => {
    dispose = render(() => (
      <Table>
        <TableRow head><TableHead align="end" priority="low">Cost</TableHead></TableRow>
        <TableRow><TableCell align="end">1.50</TableCell></TableRow>
      </Table>
    ), host)
    const head = host.querySelector<HTMLElement>('th[scope="col"]')!
    expect(head.dataset.align).toBe('end')
    expect(head.dataset.priority).toBe('low')
    expect(head.getAttribute('style')).toBeNull()
    expect(host.querySelector<HTMLElement>('td')!.dataset.align).toBe('end')
  })

  it('gives a row with an action a keyboard as well as a click', () => {
    const presses: string[] = []
    dispose = render(() => (
      <Table>
        <TableRow onPress={() => presses.push('press')}><TableCell>a</TableCell></TableRow>
        <TableRow><TableCell>b</TableCell></TableRow>
      </Table>
    ), host)
    const [pressable, inert] = host.querySelectorAll('tr')
    expect(pressable.getAttribute('role')).toBe('button')
    expect(pressable.getAttribute('tabindex')).toBe('0')
    expect(inert.getAttribute('role')).toBeNull()

    pressable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(presses).toHaveLength(1)

    // A key inside a cell's own control belongs to that control, not to the row.
    pressable.querySelector('td')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(presses).toHaveLength(1)
  })
})
