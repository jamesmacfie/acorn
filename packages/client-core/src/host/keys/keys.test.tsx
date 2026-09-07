import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUTS } from '../layouts'
import { _resetLayoutState } from '../layouts/state'
import type { LayoutProps, Region } from '../layouts/regions'
import { Row } from '../../kit/components/primitives'
import { Rows } from '../../kit/components/layout/Rows'
import { Tabs } from '../../kit/components/layout/Tabs'
import { Modal } from '../../kit/components/overlays/Modal'
import { revealCollectionItem } from '../../kit/keys/collection'
import { _resetCollectionState, collectionState } from '../../kit/keys/collectionState'
import { registerCommands } from '../registries/commands/commands'
import type { ResolvedKeybinding } from '../registries/commands/keybindings'
import { installKeymap } from './install'
import { _resetRegions, focusedRegion, moveRegion } from './focusRegions'

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
  // jsdom implements no layout, so it ships no `scrollIntoView`. Stubbed rather than guarded in the
  // node: every real host has it, and an optional call there would hide a genuine break.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
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

  it('renders a tree, with the same collection behind it, when the rows are nested', () => {
    dispose = render(() => (
      <Rows tree id="files" ariaLabel="Files" items={PULLS}>
        {(item, itemProps, selected) => <Row item={itemProps} selected={selected()}>{item.label}</Row>}
      </Rows>
    ), host)
    const list = host.querySelector<HTMLElement>('.ui-rows')!
    // `tree` is what a file tree and a request tree are; the roles differ because a screen reader
    // announces "expandable" for one and not the other, and nothing else about the collection does.
    expect(list.getAttribute('role')).toBe('tree')
    expect(list.getAttribute('aria-activedescendant')).toBe('files-item-0')
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

describe('a virtualised run of rows is the same collection', () => {
  // github's pull list draws thousands of rows and used to own a virtualizer, a scroll element and a
  // pair of animation frames to do it. `Rows virtual` is that, in the kit, and the point of the test
  // is that nothing about the collection changes: the keys, the roles and the stored place are still
  // the whole list's, not the drawn window's. jsdom measures nothing, so the window here is empty,
  // which is exactly the case that has to keep working.
  it('keeps the whole list in the collection while its own scroller draws the window', () => {
    dispose = render(() => (
      <Rows virtual id="virtual-pulls" ariaLabel="Pull requests" items={PULLS}>
        {(item, itemProps, selected, place) => (
          <Row item={itemProps} selected={selected()} offset={place.offset} height={place.height}>{item.label}</Row>
        )}
      </Rows>
    ), host)
    const list = host.querySelector<HTMLElement>('.ui-rows')!
    expect(host.querySelector('.ui-rows-scroll')).not.toBeNull()
    expect(list.getAttribute('role')).toBe('listbox')
    // The roving stop is the first item of the data, not of whatever happens to be on screen.
    expect(list.getAttribute('aria-activedescendant')).toBe('virtual-pulls-item-0')
    revealCollectionItem('virtual-pulls', 'pr-3')
    expect(collectionState('virtual-pulls').active).toBe('pr-3')
  })
})

describe('something outside a collection can put an item in view', () => {
  // Notes' "view in Context" hands context a section and an item id and nothing else. The kit gives a
  // pane no class and no id to select a row on, which is the point, so the collection publishes the one
  // operation and scroll stays the host's (./collection.ts).
  it('makes the named item the roving stop', () => {
    mountRows()
    revealCollectionItem('pulls', 'pr-3')
    expect(collectionState('pulls').active).toBe('pr-3')
  })

  it('does nothing for a key the collection does not hold, rather than clearing its place', () => {
    mountRows()
    revealCollectionItem('pulls', 'pr-2')
    revealCollectionItem('pulls', 'pr-404')
    expect(collectionState('pulls').active).toBe('pr-2')
  })

  it('does nothing for a collection that is not on screen', () => {
    expect(() => revealCollectionItem('nothing-here', 'pr-1')).not.toThrow()
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

  // A strip whose labels are all the same shape — github's pull strip labels every tab `#1234` —
  // needs a mark and a tooltip to tell them apart, and neither may cost the tab its role.
  it('draws a mark and a title on a tab that asks for one', () => {
    dispose = render(() => (
      <Tabs
        tabs={[{ id: 'one', label: '#1', icon: 'link-2', title: 'Mentioned in #2' }, { id: 'two', label: '#2' }]}
        active="one"
        onChange={() => {}}
        idPrefix="marked"
        ariaLabel="Pulls"
      />
    ), host)
    const [first, second] = host.querySelectorAll<HTMLElement>('.ui-tab')
    expect(first.querySelector('.ui-icon')).not.toBeNull()
    expect(first.title).toBe('Mentioned in #2')
    expect(first.getAttribute('role')).toBe('tab')
    expect(second.querySelector('.ui-icon')).toBeNull()
    expect(second.title).toBe('')
  })
})

describe('a modal is a trap', () => {
  it('is a dialog, and hands focus back to whatever opened it', () => {
    // Outside `host`: Solid's `render` dispose empties its container, which would take the opener
    // with it and prove nothing.
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    dispose = render(() => <Modal title="Archive task" onDismiss={() => {}}><span>body</span></Modal>, host)
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

  // Every layout, not just the one the phase happened to write a test for. A hole in the cycle is a
  // region a keyboard can leave and not come back to, and it is a property of the layout rather than
  // of whatever pane declared it (docs/command-palette-and-shortcuts.md § Focus and typing, on the rules with tests behind
  // them, "every focus group has an entry and an exit").
  //
  // `regions` is what the layout is mounted with; `groups` is how many focus groups it actually draws,
  // which is not the same number. `header-body-footer` fills three regions and is one group, because
  // the header and the footer join the body unless they hold a stop of their own; `tabs` draws one
  // panel at a time. A layout with one group is a cycle of one, closed by construction, and
  // `moveRegion` says so by refusing to move rather than by wrapping onto itself.
  const WALKS: [keyof typeof LAYOUTS, string[], number][] = [
    ['single', ['body'], 1],
    ['list-detail', ['list', 'detail'], 2],
    ['header-body-footer', ['header', 'body', 'footer'], 1],
    ['tabs', ['panel:one'], 1],
    ['document-over-frame', ['document', 'frame'], 2],
    ['frame-beside-document', ['document', 'frame'], 2],
    ['stack-split', ['top', 'bottom'], 2],
    ['wizard', ['step'], 1],
  ]

  it.each(WALKS)('walks %s and comes back where it started', (layout, names, groups) => {
    mount(layout, {
      regions: Object.fromEntries(names.map((name) => [name, text(name)])),
      ...(layout === 'tabs' ? { tabs: [{ id: 'one', label: 'One' }] } : {}),
      ...(layout === 'wizard' ? { steps: [{ id: 'one', label: 'One' }], current: 'one' } : {}),
    })
    host.querySelector<HTMLElement>(`[data-region="${names[0]}"]`)!.focus()
    const start = focusedRegion()
    expect(start).not.toBeNull()
    if (groups < 2) {
      expect(moveRegion(1)).toBe(false)
      expect(focusedRegion()).toEqual(start)
      return
    }
    for (let step = 0; step < groups; step++) expect(moveRegion(1)).toBe(true)
    expect(focusedRegion()).toEqual(start)
    // And the other way, which is a separate question: `prevRegion` walking the same ring backwards
    // is what makes a region reachable from either side.
    for (let step = 0; step < groups; step++) expect(moveRegion(-1)).toBe(true)
    expect(focusedRegion()).toEqual(start)
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
    commands = registerCommands([
      { id: 'core.test', title: 'Test', category: 'action', run: () => { ran.push('core.test') } },
      { id: 'core.bare', title: 'Bare', category: 'action', run: () => { ran.push('core.bare') } },
    ])
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

  // A chord carrying a command modifier reaches a scoped binding from inside a text field, because
  // nothing types Cmd+K into a message. Before this a pane's own chord could not be pressed in the
  // pane's own field, which is where the changes pane's Commit lives. The sandboxed-frame SDK and
  // the terminal host's command layer already drew the line here (./install.ts § scopeActive).
  it('runs a scoped chord from inside a text field, and holds a bare key back', () => {
    installWith([
      binding({ when: 'task' }),
      binding({ id: 'core.bare', command: 'core.bare', defaultChord: 'r', chord: 'r', when: 'task' }),
    ])
    const input = document.createElement('input')
    host.append(input)
    input.focus()

    press('k', { metaKey: true })
    expect(ran).toEqual(['core.test'])

    // `r` is a letter somebody is typing, so the field keeps it.
    press('r', { code: 'KeyR' })
    expect(ran).toEqual(['core.test'])
    input.blur()
    press('r', { code: 'KeyR' })
    expect(ran).toEqual(['core.test', 'core.bare'])
  })

  // Which is the scope's whole point: a bare key that says it is exempt from typing gets what it
  // asked for, modifier or not.
  it('holds a typing-exempt binding back while something is being typed into', () => {
    installWith([binding({ when: 'typing-exempt' })])
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
