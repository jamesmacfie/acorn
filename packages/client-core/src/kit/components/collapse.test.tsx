import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetSidebarCollapse, paneCollapseKey, sidebarCollapse } from '../lib/layout/collapseState'
import { ListDetail, Row } from './primitives'

// A collapsed sidebar is two decisions taken from one signal: the column's width and each row's rail
// form. They are made in different files and cannot reach each other, so what these pin is that both
// read the same state and that a row in a rail still names itself.

let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  localStorage.clear()
  _resetSidebarCollapse()
})
afterEach(() => {
  host.remove()
  localStorage.clear()
  _resetSidebarCollapse()
})

describe('the collapse signal', () => {
  it('is one signal per sidebar, whoever asks', () => {
    const setCollapsed = sidebarCollapse('github')[1]
    const [again] = sidebarCollapse('github')
    setCollapsed(true)
    expect(again()).toBe(true)
    expect(sidebarCollapse('linear')[0]()).toBe(false)
  })

  it('survives a reload, and expanding forgets rather than storing a zero', () => {
    sidebarCollapse('github')[1](true)
    expect(localStorage.getItem('sidebar:github')).toBe('1')
    _resetSidebarCollapse()
    expect(sidebarCollapse('github')[0]()).toBe(true)

    sidebarCollapse('github')[1](false)
    expect(localStorage.getItem('sidebar:github')).toBe(null)
    _resetSidebarCollapse()
    expect(sidebarCollapse('github')[0]()).toBe(false)
  })

  it('keeps a pane and a browse source of the same name apart', () => {
    expect(paneCollapseKey('agents')).not.toBe('agents')
    sidebarCollapse(paneCollapseKey('agents'))[1](true)
    expect(sidebarCollapse('agents')[0]()).toBe(false)
  })
})

describe('a collapsed ListDetail', () => {
  it('leaves a split alone until it is given a key', () => {
    render(() => <ListDetail list={<span>the list</span>}>the detail</ListDetail>, host)
    expect(host.querySelector('.ui-listdetail-edge')).toBe(null)
    expect(host.querySelector('.ui-split-handle')).not.toBe(null)
  })

  it('takes the rail width and drops the grip, and the drag cannot override it', () => {
    render(() => <ListDetail collapseKey="github" list={<span>the list</span>}>the detail</ListDetail>, host)
    const root = host.querySelector<HTMLElement>('.ui-listdetail')!
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(root, 'offsetWidth', { configurable: true, value: 800 })
    Object.defineProperty(host.querySelector('.ui-listdetail-list')!, 'offsetWidth', { configurable: true, value: 200 })
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(root.dataset.list).toBe('default')
    expect(root.style.gridTemplateColumns).toBe('216px 1px minmax(0, 1fr)')

    // The toggle is the one button on the edge; the grip is a separator, not a button.
    host.querySelector<HTMLElement>('.ui-listdetail-edge .ui-btn')!.click()
    expect(root.dataset.list).toBe('collapsed')
    expect(host.querySelector('[role="separator"]')).toBe(null)
    // A width nobody can drag to is a width that must stop being applied.
    expect(root.style.gridTemplateColumns).toBe('')
  })

  it('hides unreadable list content without unmounting it', () => {
    let mounted = 0
    const List = () => {
      mounted += 1
      return <input value="retained search" />
    }
    render(() => (
      <ListDetail collapseKey="editor" collapseContent="empty" list={<List />}>the detail</ListDetail>
    ), host)
    const list = host.querySelector<HTMLElement>('.ui-listdetail-list')!
    const input = list.querySelector('input')!
    const toggle = host.querySelector<HTMLButtonElement>('.ui-listdetail-edge .ui-btn')!

    toggle.click()
    expect(list.style.visibility).toBe('hidden')
    expect(list.querySelector('input')).toBe(input)
    expect(toggle.getAttribute('aria-label')).toBe('Expand list')

    toggle.click()
    expect(list.style.visibility).toBe('')
    expect(list.querySelector('input')).toBe(input)
    expect(mounted).toBe(1)
  })
})

describe('a pane that does not offer the control', () => {
  it('draws its column in full, whatever was stored for it earlier', () => {
    // A flag left by a build where the pane was collapsible must not strand a reader in a 48px column
    // with no way to widen it.
    sidebarCollapse(paneCollapseKey('http'))[1](true)
    render(() => (
      <ListDetail list={<span>the list</span>}>the detail</ListDetail>
    ), host)
    expect(host.querySelector<HTMLElement>('.ui-listdetail')!.dataset.list).toBe('default')
    expect(host.querySelector('.ui-listdetail-edge')).toBe(null)
  })
})

describe('a row in a rail', () => {
  it('draws the slot instead of the row, and still answers to its name', () => {
    render(() => (
      <Row title="Fix the parser" label="Fix the parser" collapsed={<span class="mark">●</span>} meta={<span>meta</span>}>
        Fix the parser
      </Row>
    ), host)
    const row = host.querySelector<HTMLElement>('.ui-row')!
    expect(row.dataset.collapsed).toBe('')
    expect(host.querySelector('.ui-row-collapsed .mark')).not.toBe(null)
    expect(host.querySelector('.ui-row-body')).toBe(null)
    expect(host.querySelector('.ui-row-meta')).toBe(null)
    // The tooltip is on the row, so it answers a pointer and the keyboard alike.
    expect(row.getAttribute('data-tip')).toBe('Fix the parser')
  })

  it('drops the depth it has no width for', () => {
    render(() => <Row depth={2} nested reveal collapsed={<span>●</span>}>child</Row>, host)
    const row = host.querySelector<HTMLElement>('.ui-row')!
    expect(row.dataset.depth).toBe(undefined)
    expect(row.dataset.nested).toBe(undefined)
    expect(row.dataset.reveal).toBe(undefined)
  })

  it('is the row it always was without the slot', () => {
    render(() => <Row depth={2} title="Fix the parser">Fix the parser</Row>, host)
    const row = host.querySelector<HTMLElement>('.ui-row')!
    expect(row.dataset.collapsed).toBe(undefined)
    expect(row.getAttribute('data-tip')).toBe(null)
    expect(row.dataset.depth).toBe('2')
    expect(host.querySelector('.ui-row-body')?.textContent).toBe('Fix the parser')
  })
})

describe('a row with a tip', () => {
  it('shows the tip at full width, its name in a rail, and never the browser tooltip too', () => {
    const [rail, setRail] = createSignal(false)
    render(() => (
      <Row title="Fix the parser" tip="Last active today" tipAt={1000} collapsed={rail() ? <span>●</span> : undefined}>
        Fix the parser
      </Row>
    ), host)
    const row = host.querySelector<HTMLElement>('.ui-row')!
    expect(row.getAttribute('data-tip')).toBe('Last active today')
    expect(row.getAttribute('data-tip-at')).toBe('1000')
    expect(row.getAttribute('title')).toBe(null)
    setRail(true)
    expect(row.getAttribute('data-tip')).toBe('Fix the parser')
    expect(row.getAttribute('data-tip-at')).toBe('1000')
  })
})
