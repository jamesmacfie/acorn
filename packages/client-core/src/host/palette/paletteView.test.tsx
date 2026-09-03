import { render } from 'solid-js/web'
import { Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Alert } from '../../kit/components/primitives'
import type { Disposable } from '../../kit/lib/registry'
import { commandRegistry, type CommandContribution, type CommandExecutionContext } from '../registries/commands/commands'
import type { CommandSession } from '../registries/commands/session'
import { createCommandPaletteView } from './paletteView'
import { PaletteSurface } from './PaletteSurface'

// The desktop half of the palette, over the shared session.
//
// The transitions themselves are `../registries/commands/session.test.tsx` and are not repeated here.
// What this file asks is the part only a DOM can answer: does the dialog say what it is to a screen
// reader, does the field name the row the arrows are on, does the keyboard reach the same operations,
// and does focus come back to where it was — on the final close, and not on the way back up.

const held: Disposable[] = []
const register = (command: CommandContribution): void => {
  held.push(commandRegistry.register(command))
}

const group = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id, title: id, category: 'navigation', palette: true, kind: 'group', ...over,
} as CommandContribution)

const leaf = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id, title: id, category: 'action', palette: true, run: () => {}, ...over,
} as CommandContribution)

const CONTEXT: CommandExecutionContext = {
  host: 'desktop', nodeId: 'node-1', workspaceId: null, projectId: null, taskId: null,
  paneId: null, surfaceId: null,
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let session!: CommandSession

const mount = (): void => {
  dispose = render(() => {
    const view = createCommandPaletteView({
      id: 'commands-test',
      title: 'Command palette',
      toggleChord: 'meta+k',
      context: () => CONTEXT,
    })
    session = view.session
    return (
      <PaletteSurface
        palette={view.view}
        items={view.session.rows()}
        ariaLabel="Command palette"
        placeholder={view.session.placeholder() || 'Run a command…'}
        onComposing={view.session.setComposing}
        emptyText="No matches."
        breadcrumb={view.session.breadcrumb()}
        busy={view.session.busy()}
        announce={view.session.status() || (view.session.rows().length === 1 ? '1 result' : `${view.session.rows().length} results`)}
        status={<Show when={view.session.status()}><Alert>{view.session.status()}</Alert></Show>}
        onPick={(row) => view.session.activateRow(row.id)}
        row={(row) => <span class="palette-label">{row.label}</span>}
      />
    )
  }, host)
}

const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]')
const field = (): HTMLInputElement => document.querySelector('input')!
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const activeRowText = (): string | undefined =>
  options().find((row) => row.id === field().getAttribute('aria-activedescendant'))?.textContent ?? undefined

const press = (key: string): void => {
  dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const disposable of held.splice(0).reverse()) disposable.dispose()
})

describe('the dialog', () => {
  it('is a combobox over a listbox, and names the row the arrows are on', () => {
    register(leaf('cmd.one', { title: 'One' }))
    register(leaf('cmd.two', { title: 'Two' }))
    mount()
    session.openRoot()

    expect(dialog()?.getAttribute('aria-modal')).toBe('true')
    expect(field().getAttribute('role')).toBe('combobox')
    expect(field().getAttribute('aria-controls')).toBe(document.querySelector('[role="listbox"]')?.id)
    expect(options()).toHaveLength(2)
    expect(activeRowText()).toBe('One')

    press('ArrowDown')
    expect(activeRowText()).toBe('Two')
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true')
    press('ArrowUp')
    expect(activeRowText()).toBe('One')
  })

  it('announces what the frame is doing', async () => {
    register(leaf('cmd.stay', { title: 'Stay', run: () => ({ effect: 'stay' as const, status: 'Saved' }) }))
    mount()
    session.openRoot()
    const live = document.querySelector('[role="status"]')
    expect(live?.textContent).toBe('1 result')

    press('Enter')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(live?.textContent).toBe('Saved')
    expect(document.querySelector('.ui-alert')?.textContent).toContain('Saved')
  })

  it('marks itself busy while something is in flight', async () => {
    let release = (): void => {}
    register(leaf('cmd.slow', { title: 'Slow', run: () => new Promise<void>((resolve) => { release = () => resolve() }) }))
    mount()
    session.openRoot()
    expect(dialog()?.getAttribute('aria-busy')).toBeNull()

    press('Enter')
    expect(dialog()?.getAttribute('aria-busy')).toBe('true')
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dialog()).toBeNull()
  })
})

describe('the keyboard', () => {
  it('runs the same Enter/Escape sequence the terminal does, and draws the breadcrumb', () => {
    register(group('a', { title: 'A' }))
    register(group('a.b', { title: 'B', parentId: 'a' }))
    register(leaf('a.b.c', { title: 'C', parentId: 'a.b' }))
    mount()
    session.openRoot()

    expect(options().map((row) => row.textContent)).toEqual(['A'])
    press('Enter')
    expect(options().map((row) => row.textContent)).toEqual(['B'])
    press('Enter')
    expect(options().map((row) => row.textContent)).toEqual(['C'])
    expect(document.querySelector('.palette-crumbs')?.textContent).toBe('A › B')

    press('Escape')
    expect(options().map((row) => row.textContent)).toEqual(['B'])
    press('Escape')
    expect(options().map((row) => row.textContent)).toEqual(['A'])
    press('Escape')
    expect(dialog()).toBeNull()
  })
})

describe('focus', () => {
  it('goes back where it was, on the final close and not on the way up', async () => {
    register(group('a', { title: 'A' }))
    register(leaf('a.b', { title: 'B', parentId: 'a' }))
    mount()
    // Beside the render root, not inside it: Solid's `render` owns its container's children and
    // wipes them when what it drew goes away, which would take this button with it.
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    expect(document.activeElement).toBe(before)

    session.openRoot()
    // The field takes the keys on the next microtask, which is when the element exists to take them.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(field())

    press('Enter')
    press('Escape')
    // A pop is still inside the palette, so the button underneath must not get the keys back.
    expect(dialog()).not.toBeNull()
    expect(document.activeElement).toBe(field())

    press('Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(before)
    before.remove()
  })
})

describe('the interactive frames', () => {
  const type = (text: string): void => {
    const element = field()
    element.value = text
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('draws a search through loading, results and its own placeholder, and picks with the keyboard', async () => {
    let release: (items: { id: string; title: string }[]) => void = () => {}
    const picked: string[] = []
    register({
      id: 'find', title: 'Find', category: 'action', palette: true, kind: 'search',
      placeholder: 'Search issues…', minQueryLength: 0, debounceMs: 0,
      query: () => new Promise((resolve) => { release = resolve }),
      select: (item: { id: string }) => { picked.push(item.id) },
    } as unknown as CommandContribution)
    mount()
    session.openAt('find')
    await settle()

    expect(field().placeholder).toBe('Search issues…')
    expect(options().map((row) => row.textContent)).toEqual(['Searching…'])
    expect(dialog()?.getAttribute('aria-busy')).toBe('true')
    // An explanatory row is not a tab stop and not the cursor: there is nothing to press Enter on.
    expect(field().getAttribute('aria-activedescendant')).toBeNull()

    release([{ id: 'i-1', title: 'One' }, { id: 'i-2', title: 'Two' }])
    await settle()
    expect(options().map((row) => row.textContent)).toEqual(['One', 'Two'])
    expect(dialog()?.getAttribute('aria-busy')).toBeNull()

    press('ArrowDown')
    expect(activeRowText()).toBe('Two')
    press('Enter')
    await settle()
    expect(picked).toEqual(['i-2'])
    expect(dialog()).toBeNull()
  })

  it('holds a query back while an IME is composing a character', async () => {
    const asked: string[] = []
    register({
      id: 'find', title: 'Find', category: 'action', palette: true, kind: 'search',
      minQueryLength: 0, debounceMs: 0,
      query: async (text: string) => { asked.push(text); return [] },
      select: () => {},
    } as unknown as CommandContribution)
    mount()
    session.openAt('find')
    await settle()
    expect(asked).toEqual([''])

    field().dispatchEvent(new Event('compositionstart', { bubbles: true }))
    type('にほ')
    type('にほん')
    await settle()
    expect(asked).toEqual([''])

    field().dispatchEvent(new Event('compositionend', { bubbles: true }))
    await settle()
    expect(asked).toEqual(['', 'にほん'])
  })

  it('submits an input on Enter, shows it pending, and keeps the text when it fails', async () => {
    let answer: () => Promise<void> = () => Promise.reject(new Error('the node said no'))
    register({
      id: 'ask', title: 'Ask', category: 'action', palette: true, kind: 'input',
      placeholder: 'Describe the query…',
      submit: () => answer(),
    } as unknown as CommandContribution)
    mount()
    session.openAt('ask')

    expect(field().placeholder).toBe('Describe the query…')
    expect(options().map((row) => row.textContent)).toEqual(['Press Enter to submit.'])

    type('rows per project')
    press('Enter')
    expect(options().map((row) => row.textContent)).toEqual(['Submitting…'])
    await settle()
    expect(dialog()).not.toBeNull()
    expect(field().value).toBe('rows per project')
    expect(document.querySelector('.ui-alert')?.textContent).toContain('the node said no')

    answer = () => Promise.resolve()
    press('Enter')
    await settle()
    expect(dialog()).toBeNull()
  })
})
