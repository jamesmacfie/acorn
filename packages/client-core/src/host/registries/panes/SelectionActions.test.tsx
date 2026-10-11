import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionActions, type SelectedContent } from './SelectionActions'
import { registerContextMenuItems, type ContentSelectionTarget } from './contextMenus'
import type { Disposable } from '../../../kit/lib/state/registry'

// The desktop's door to `content.selection`: the selection is read only when the person asks, only
// inside the owner, and a row runs only on what the owner still shows.

let dispose: (() => void) | undefined
const registered: Disposable[] = []
afterEach(() => {
  dispose?.()
  dispose = undefined
  while (registered.length) registered.pop()!.dispose()
  document.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

const target = (selected: SelectedContent, over: Partial<ContentSelectionTarget> = {}): ContentSelectionTarget => ({
  location: 'content.selection',
  nodeId: 'node-a',
  taskId: 'task-1',
  projectId: 'p1',
  ownerId: 'agents',
  contentKind: selected.contentKind,
  ...(selected.languageId ? { languageId: selected.languageId } : {}),
  readOnly: true,
  text: selected.text,
  revision: 3,
  ...over,
})

const explain = () => {
  const run = vi.fn()
  registered.push(
    registerContextMenuItems([{ id: 'explain', location: 'content.selection', label: 'Explain', order: 1, run }]),
  )
  return run
}

// Two owners side by side: a paragraph and a fence in the first, a paragraph in the second.
const mount = (options: { current?: () => boolean } = {}) => {
  const select = vi.fn((selected: SelectedContent | undefined) => selected && target(selected))
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <>
        <SelectionActions select={select} isCurrent={() => options.current?.() ?? true}>
          <p id="first">Ship the release today</p>
          <div class="ui-code-wrap" data-language="ts">
            <pre>
              <code id="code">const a = 1</code>
            </pre>
          </div>
          <a id="link" href="https://example.com">
            a link
          </a>
        </SelectionActions>
        <SelectionActions select={select} isCurrent={() => true}>
          <p id="second">Another message</p>
        </SelectionActions>
      </>
    ),
    host,
  )
  return { select }
}

const selectText = (from: string, fromOffset: number, to = from, toOffset?: number) => {
  const start = document.getElementById(from)!.firstChild!
  const end = document.getElementById(to)!.firstChild!
  const range = document.createRange()
  range.setStart(start, fromOffset)
  range.setEnd(end, toOffset ?? end.textContent!.length)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
}

const rightClick = (id: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20, ...init })
  document.getElementById(id)!.dispatchEvent(event)
  return event
}

const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
const press = (label: string) =>
  items()
    .find((item) => item.textContent?.trim() === label)!
    .click()

describe('SelectionActions', () => {
  it('reads the selection only when asked, and runs a row with the owner’s target', () => {
    const run = explain()
    const { select } = mount()
    selectText('first', 5)
    // Changing the selection asks the owner nothing and runs nothing.
    document.dispatchEvent(new Event('selectionchange'))
    selectText('first', 0, 'first', 4)
    document.dispatchEvent(new Event('selectionchange'))
    expect(select).not.toHaveBeenCalled()

    expect(rightClick('first').defaultPrevented).toBe(true)
    expect(select).toHaveBeenCalledWith({ text: 'Ship', contentKind: 'markdown' })
    expect(items().map((item) => item.textContent?.trim())).toEqual(['Copy', 'Explain'])
    expect(run).not.toHaveBeenCalled()
    press('Explain')
    expect(run).toHaveBeenCalledWith(target({ text: 'Ship', contentKind: 'markdown' }))
  })

  it('calls a selection inside one fence code, in the editor’s language ids', () => {
    explain()
    const { select } = mount()
    selectText('code', 0, 'code', 5)
    rightClick('code')
    expect(select).toHaveBeenCalledWith({ text: 'const', contentKind: 'code', languageId: 'typescript' })
  })

  it('leaves the platform menu alone for no selection, another owner’s, a link, Option, or no rows', () => {
    explain()
    const { select } = mount()
    expect(rightClick('first').defaultPrevented).toBe(false)
    expect(select).toHaveBeenLastCalledWith(undefined)
    // A selection that runs into the next owner belongs to neither.
    selectText('first', 0, 'second', 3)
    expect(rightClick('first').defaultPrevented).toBe(false)
    expect(select).toHaveBeenLastCalledWith(undefined)
    selectText('first', 0)
    select.mockClear()
    expect(rightClick('link').defaultPrevented).toBe(false)
    expect(rightClick('first', { altKey: true }).defaultPrevented).toBe(false)
    expect(select).not.toHaveBeenCalled()
    registered.pop()!.dispose()
    expect(rightClick('first').defaultPrevented).toBe(false)
    expect(items()).toEqual([])
  })

  it('explains an oversized selection and offers no row, counting UTF-8 bytes', () => {
    const run = explain()
    mount()
    // 22,000 four-byte characters: 44,000 UTF-16 units but 88,000 bytes.
    document.getElementById('first')!.firstChild!.textContent = '😀'.repeat(22_000)
    selectText('first', 0)
    rightClick('first')
    expect(items().map((item) => item.textContent?.trim())).toEqual(['Copy'])
    expect(document.body.textContent).toContain('This selection is over 64 KiB')
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a row once the owner’s content changed while the menu was open', () => {
    const run = explain()
    let current = true
    mount({ current: () => current })
    selectText('first', 0, 'first', 4)
    rightClick('first')
    current = false
    press('Explain')
    expect(run).not.toHaveBeenCalled()
  })

  it('puts the person’s selection back when the menu closes', async () => {
    explain()
    mount()
    selectText('first', 0, 'first', 4)
    rightClick('first')
    // What WebKit does when the first item takes focus.
    document.getSelection()!.removeAllRanges()
    press('Copy')
    await vi.waitFor(() => expect(document.getSelection()!.toString()).toBe('Ship'))
  })

  it('drops the open menu when the owner unmounts', () => {
    explain()
    mount()
    selectText('first', 0, 'first', 4)
    rightClick('first')
    expect(items()).toHaveLength(2)
    dispose!()
    dispose = undefined
    expect(items()).toEqual([])
  })
})
