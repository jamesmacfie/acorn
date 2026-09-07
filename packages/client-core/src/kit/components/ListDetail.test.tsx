import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ListDetail } from './primitives'

// The list arrives in a prop, and a prop is a getter: every read re-runs the JSX the caller wrote
// there. ListDetail read it three times, so the column was built three times over and the copies
// fought over the same nodes. Docker's rail source drew an empty column
// (docs/ui-design.md § Two-column panes).

let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => host.remove())

describe('ListDetail', () => {
  it('builds the list column once', () => {
    let built = 0
    const List = () => {
      built += 1
      return <span>the list</span>
    }
    render(() => <ListDetail list={<List />}>the detail</ListDetail>, host)

    expect(built).toBe(1)
    expect(host.querySelectorAll('.ui-listdetail-list').length).toBe(1)
    expect(host.querySelector('.ui-listdetail-list')?.textContent).toBe('the list')
  })
})
