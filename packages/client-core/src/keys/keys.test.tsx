import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUTS } from '../layouts'
import { _resetLayoutState } from '../layouts/state'
import type { LayoutProps, Region } from '../layouts/regions'
import { Row } from '../ui/primitives'
import { Rows } from '../ui/Rows'
import { Tabs } from '../ui/Tabs'
import { Modal } from '../ui/Modal'
import { _resetCollectionState, collectionState } from './collectionState'
import { registerCommands } from '../registries/commands'
import type { ResolvedKeybinding } from '../registries/keybindings'
import { installKeymap } from './install'
import { _resetRegions, focusedRegion, moveRegion } from './regions'

// The keyboard, rendered. The logic suite proves the tables; this proves the part only a document
// can answer: that a key reaches the engine, that the engine reaches the node, that a rebuilt list
// keeps its place, and that the region cycle closes.

let host: HTMLElement
let dispose: (() => void) | undefined
let teardown: (() => void) | undefined

const press = (key: string, init: KeyboardEventInit = {}) => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** The shell root, installed the way `KeybindingDispatcher` does it. */
const install = () => {
  teardown = render(() => {
    installKeymap(document.documentElement, { prefs: () => ({ taskActive: true }), bindings: () => [] })
    return null
  }, document.createElement('div'))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  _resetCollectionState()
  _resetLayoutState()
  _resetRegions()
  install()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  teardown?.()
  teardown = undefined
  host.remove()
})

const PULLS = [
  { key: 'pr-1', label: 'Fix the thing' },
  { key: 'pr-2', label: 'Bump the dep' },
  { key: 'pr-3', label: 'Zap the cache' },
]

function mountRows(items = PULLS) {
  dispose = render(() => (
    <Rows id="pulls" ariaLabel="Pull requests" items={items}>
      {(item, itemProps, selected) => <Row item={itemProps} selected={selected()}>{item.label}</Row>}
    </Rows>
  ), host)
  return host.querySelector<HTMLElement>('.ui-rows')!
}

describe('a run of rows is a collection', () => {
  it('renders a listbox whose active option is named', () => {
    const list = mountRows()
    expect(list.getAttribute('role')).toBe('listbox')
    expect(list.getAttribute('aria-activedescendant')).toBe('pulls-item-0')
    expect([...list.querySelectorAll('[role="option"]')]).toHaveLength(3)
    // One tab stop: the active row is reachable and the rest are not.
    expect([...list.querySelectorAll('.ui-row')].map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('walks with the arrows, j and k, Home and End, without the pane doing anything', () => {
    const list = mountRows()
    list.querySelector<HTMLElement>('.ui-row')!.focus()
    press('ArrowDown')
    expect(collectionState('pulls').active).toBe('pr-2')
    press('j')
    expect(collectionState('pulls').active).toBe('pr-3')
    press('k')
    expect(collectionState('pulls').active).toBe('pr-2')
    press('End')
    expect(collectionState('pulls').active).toBe('pr-3')
    press('Home')
    expect(collectionState('pulls').active).toBe('pr-1')
    // Wraps, so a list has no dead end.
    press('ArrowUp')
    expect(collectionState('pulls').active).toBe('pr-3')
  })

  it('selects on activate and reports the selection back to the row', () => {
    const list = mountRows()
    list.querySelector<HTMLElement>('.ui-row')!.focus()
    press('ArrowDown')
    press('Enter')
    expect(collectionState('pulls').selected).toBe('pr-2')
    expect(list.querySelectorAll('.ui-row')[1].getAttribute('aria-selected')).toBe('true')
  })

  it('keeps its place when the same keys come back in a new array', () => {
    const list = mountRows()
    list.querySelector<HTMLElement>('.ui-row')!.focus()
    press('ArrowDown')
    press('Enter')
    dispose?.()
    host.replaceChildren()
    // A refetch: same keys, all-new objects, and the rows remount. `active` and `selected` are held
    // outside the rows, so neither moves.
    mountRows(PULLS.map((item) => ({ ...item })))
    expect(collectionState('pulls').active).toBe('pr-2')
    expect(collectionState('pulls').selected).toBe('pr-2')
  })
})

describe('a tab strip is a collection', () => {
  it('is a tablist whose arrows move the selection', () => {
    let active = 'one'
    dispose = render(() => (
      <Tabs
        tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]}
        active={active}
        onChange={(id) => { active = id }}
        idPrefix="panel"
        ariaLabel="Sections"
      />
    ), host)
    const strip = host.querySelector<HTMLElement>('.ui-tabs')!
    expect(strip.getAttribute('role')).toBe('tablist')
    // The tab keeps the id the panel points back at.
    expect(strip.querySelector('.ui-tab')!.id).toBe('panel-tab-one')
    strip.querySelector<HTMLElement>('.ui-tab')!.focus()
    press('ArrowRight')
    expect(active).toBe('two')
  })
})

describe('a modal is a trap', () => {
  it('is a dialog, and hands focus back to whatever opened it', () => {
    // Outside `host`: Solid's `render` dispose empties its container, which would take the opener
    // with it and prove nothing.
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    dispose = render(() => <Modal title="Archive task" onClose={() => {}}><span>body</span></Modal>, host)
    const dialog = host.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    dispose()
    dispose = undefined
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('layout regions are focus groups', () => {
  const text = (name: string): Region => () => <button data-region={name}>{name}</button>
  const mount = (layout: keyof typeof LAYOUTS, props: Partial<LayoutProps>) => {
    dispose = render(() => LAYOUTS[layout]({ stateKey: 'pane', label: 'Pane', regions: {}, ...props }), host)
  }

  it('walks list-detail and comes back where it started', () => {
    mount('list-detail', { regions: { list: text('list'), detail: text('detail') } })
    host.querySelector<HTMLElement>('[data-region="list"]')!.focus()
    expect(focusedRegion()).toEqual({ paneId: 'pane', regionId: 'list' })
    expect(moveRegion(1)).toBe(true)
    expect(focusedRegion()).toEqual({ paneId: 'pane', regionId: 'detail' })
    // Two regions, so one more step is the whole cycle.
    expect(moveRegion(1)).toBe(true)
    expect(focusedRegion()).toEqual({ paneId: 'pane', regionId: 'list' })
  })

  it('lands on a region rather than on the pane when it enters one', () => {
    mount('stack-split', { regions: { top: text('top'), bottom: text('bottom') } })
    host.querySelector<HTMLElement>('[data-region="top"]')!.focus()
    moveRegion(1)
    expect(document.activeElement?.getAttribute('data-region')).toBe('bottom')
  })
})

describe('the command layer still is the keybinding table', () => {
  const binding = (over: Partial<ResolvedKeybinding> = {}): ResolvedKeybinding => ({
    id: 'core.test', command: 'core.test', description: 'Test', category: 'Global',
    defaultChord: 'meta+k', chord: 'meta+k', ...over,
  })

  let ran: string[]
  let commands: { dispose: () => void }

  const installWith = (bindings: readonly ResolvedKeybinding[], taskActive = true) => {
    teardown?.()
    teardown = render(() => {
      installKeymap(document.documentElement, { prefs: () => ({ taskActive }), bindings: () => bindings })
      return null
    }, document.createElement('div'))
  }

  beforeEach(() => {
    ran = []
    commands = registerCommands([{ id: 'core.test', title: 'Test', category: 'action', run: () => { ran.push('core.test') } }])
  })
  afterEach(() => commands.dispose())

  it('runs a global chord, including from inside a text field', () => {
    installWith([binding()])
    const input = document.createElement('input')
    host.append(input)
    input.focus()
    press('k', { metaKey: true })
    // `⌘K` opening the palette while the caret is in a filter box is the behaviour people rely on.
    expect(ran).toEqual(['core.test'])
  })

  it('holds a task chord back while something is being typed into', () => {
    installWith([binding({ when: 'task' })])
    const input = document.createElement('input')
    host.append(input)
    input.focus()
    press('k', { metaKey: true })
    expect(ran).toEqual([])
    input.blur()
    press('k', { metaKey: true })
    expect(ran).toEqual(['core.test'])
  })

  it('holds a task chord back when no task is open', () => {
    installWith([binding({ when: 'task' })], false)
    press('k', { metaKey: true })
    expect(ran).toEqual([])
  })

  it('leaves Escape to whichever overlay is on top', () => {
    installWith([binding({ chord: 'escape', when: 'pane' })])
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inside = document.createElement('button')
    dialog.append(inside)
    host.append(dialog)
    inside.focus()
    press('Escape')
    // An overlay answers its own Escape (ui/dismissable.ts keeps the stack); the keymap must not
    // claim it first, or the topmost overlay never sees the press.
    expect(ran).toEqual([])
  })
})
