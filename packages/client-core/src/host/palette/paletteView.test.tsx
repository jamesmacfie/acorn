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
        placeholder="Run a command…"
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
