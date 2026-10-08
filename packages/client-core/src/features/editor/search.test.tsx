import { afterEach, describe, expect, it, vi } from 'vitest'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { openSearchPanel, searchPanelOpen } from '@codemirror/search'
import { editorSearch, MAX_COUNTED_MATCHES, openReplacePanel } from './search'

// The find panel as a reader meets it: kit controls in place of CodeMirror's stock ones, every action
// going through the engine's own commands, and nothing left behind when the editor changes documents.

// jsdom does no layout, so a Range cannot report rectangles and CodeMirror measures selections.
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => { view.dom.parentElement?.remove(); view.destroy() })
})

const stateFor = (doc: string, extra: Extension[] = []) => EditorState.create({ doc, extensions: [basicSetup, editorSearch(), ...extra] })

function mount(doc: string, extra: Extension[] = []) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ state: stateFor(doc, extra), parent })
  views.push(view)
  return view
}

const panel = (view: EditorView) => view.dom.querySelector<HTMLElement>('.cm-panels')
const field = (view: EditorView) => panel(view)?.querySelector<HTMLInputElement>('[main-field]') ?? null
const count = (view: EditorView) => panel(view)?.querySelector('.ui-findbar-count')?.textContent ?? null
const button = (view: EditorView, label: string) => {
  const found = [...panel(view)?.querySelectorAll('button') ?? []].find((element) => (element.getAttribute('aria-label') ?? element.textContent) === label)
  if (!found) throw new Error(`no ${label} button`)
  return found
}

async function open(view: EditorView) {
  openSearchPanel(view)
  await vi.waitFor(() => expect(field(view)).toBeTruthy())
}

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

describe('editorSearch', () => {
  it('draws kit controls instead of the stock panel and focuses the query', async () => {
    const view = mount('one two one')
    await open(view)
    expect(panel(view)?.querySelector('.cm-search, .cm-textfield, .cm-button')).toBeNull()
    expect(field(view)?.getAttribute('aria-label')).toBe('Find')
    expect(document.activeElement).toBe(field(view))
  })

  it('counts with the engine semantics and positions on the selected match', async () => {
    const view = mount('Foo foo food')
    await open(view)
    type(field(view)!, 'foo')
    expect(count(view)).toBe('3 matches')

    button(view, 'Match case').click()
    expect(count(view)).toBe('2 matches')
    button(view, 'Whole word').click()
    expect(count(view)).toBe('1 match')

    button(view, 'Next match').click()
    expect(count(view)).toBe('1/1')
    // A cursor elsewhere is not a current match.
    view.dispatch({ selection: { anchor: 0 } })
    expect(count(view)).toBe('1 match')
  })

  it('reports no matches and an invalid regular expression, and disables the actions', async () => {
    const view = mount('abc')
    await open(view)
    type(field(view)!, 'zzz')
    expect(count(view)).toBe('No matches')
    expect(button(view, 'Next match').disabled).toBe(true)
    expect(button(view, 'Select all matches').disabled).toBe(true)

    button(view, 'Regular expression').click()
    type(field(view)!, 'a(')
    expect(count(view)).toBe('Invalid regular expression')
    expect(field(view)?.getAttribute('aria-invalid')).toBe('true')
    expect(button(view, 'Next match').disabled).toBe(true)
  })

  it('replaces through ordinary transactions that the caller hears and undo reverts', async () => {
    const changes: string[] = []
    const view = mount('cat cat cat', [EditorView.updateListener.of((update) => { if (update.docChanged) changes.push(update.state.doc.toString()) })])
    await open(view)
    type(field(view)!, 'c(a)t')
    button(view, 'Regular expression').click()
    button(view, 'Replace').click()
    const replacement = panel(view)!.querySelector<HTMLInputElement>('input[aria-label="Replace"]')!
    type(replacement, 'd$1g')

    // The engine's rule: Replace next first selects a match, and replaces it on the next press.
    button(view, 'Replace next').click()
    expect(view.state.doc.toString()).toBe('cat cat cat')
    button(view, 'Replace next').click()
    expect(view.state.doc.toString()).toBe('dag cat cat')
    expect(changes).toEqual(['dag cat cat'])

    // basicSetup's own undo key, so the edit is checked against the history the reader has.
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }), 'editor')
    expect(view.state.doc.toString()).toBe('cat cat cat')

    button(view, 'Replace all').click()
    expect(view.state.doc.toString()).toBe('dag dag dag')
    expect(changes.at(-1)).toBe('dag dag dag')

    // An empty replacement removes the matched text.
    type(field(view)!, 'dag')
    type(replacement, '')
    button(view, 'Replace all').click()
    expect(view.state.doc.toString()).toBe('  ')
  })

  it('keeps the replacement text while the row is collapsed', async () => {
    const view = mount('a a')
    await open(view)
    button(view, 'Replace').click()
    type(panel(view)!.querySelector<HTMLInputElement>('input[aria-label="Replace"]')!, 'b')
    button(view, 'Replace').click()
    expect(panel(view)!.querySelector('input[aria-label="Replace"]')).toBeNull()
    button(view, 'Replace').click()
    expect(panel(view)!.querySelector<HTMLInputElement>('input[aria-label="Replace"]')?.value).toBe('b')
  })

  it('opens straight to the replace row for a Replace command', async () => {
    const view = mount('a a')
    await open(view)
    openReplacePanel(view)
    const replacement = panel(view)!.querySelector<HTMLInputElement>('input[aria-label="Replace"]')
    expect(replacement).toBe(document.activeElement)
    expect(button(view, 'Replace').getAttribute('aria-expanded')).toBe('true')
  })

  it('drops replacement for a read-only document and brings it back when editable', async () => {
    const lock = new Compartment()
    const view = mount('x', [lock.of(EditorState.readOnly.of(true))])
    await open(view)
    expect(() => button(view, 'Replace')).toThrow()
    view.dispatch({ effects: lock.reconfigure(EditorState.readOnly.of(false)) })
    expect(button(view, 'Replace')).toBeTruthy()
  })

  it('selects every match', async () => {
    const view = mount('ab ab ab')
    await open(view)
    type(field(view)!, 'ab')
    button(view, 'Select all matches').click()
    expect(view.state.selection.ranges).toHaveLength(3)
  })

  it('closes on Escape without the key reaching the editor box around it', async () => {
    const view = mount('text')
    const outside = vi.fn()
    view.dom.parentElement!.addEventListener('keydown', outside)
    await open(view)
    button(view, 'Match case').focus()
    button(view, 'Match case').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(searchPanelOpen(view.state)).toBe(false)
    expect(outside).not.toHaveBeenCalled()
    expect(view.hasFocus).toBe(true)
  })

  it('shows each document its own search and leaves nothing behind on a state swap', async () => {
    const view = mount('alpha beta')
    await open(view)
    type(field(view)!, 'alpha')
    const first = view.state

    const second = stateFor('beta beta')
    view.setState(second)
    expect(field(view)).toBeNull()

    view.setState(first)
    await vi.waitFor(() => expect(field(view)?.value).toBe('alpha'))
    expect(view.dom.querySelectorAll('[main-field]')).toHaveLength(1)
    expect(count(view)).toBe('1 match')
  })

  it('stops counting at the ceiling and still navigates', async () => {
    const view = mount('a'.repeat(MAX_COUNTED_MATCHES + 500))
    await open(view)
    type(field(view)!, 'a')
    expect(count(view)).toBe(`${MAX_COUNTED_MATCHES}+ matches`)
    expect(button(view, 'Next match').disabled).toBe(false)
  })
})
