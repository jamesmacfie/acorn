import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { DocumentTabs } from './DocumentTabs'

it('keeps disk Git status beside the independent unsaved-document dot', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <DocumentTabs idPrefix="editor" ariaLabel="Open files" active="a.ts" onActivate={() => {}}
    tabs={[{ id: 'a.ts', label: 'a.ts', dirty: true, fileStatus: { letter: 'M', label: 'Modified — Staged and unstaged', tone: 'muted' } }]} />, host)
  try {
    const tab = host.querySelector('[role="tab"]')!
    expect(tab.textContent).toContain('a.tsM')
    expect(tab.getAttribute('aria-label')).toBe('a.ts, Modified — Staged and unstaged, Unsaved changes')
    expect(tab.querySelector('[aria-label="Modified — Staged and unstaged"]')).not.toBeNull()
    expect(tab.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull()
  } finally { dispose(); host.remove() }
})

it('renders a focusable action for an inactive tab without activating it', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const activated: string[] = []
  const targeted: string[] = []
  const dispose = render(() => <DocumentTabs idPrefix="editor-menu" ariaLabel="Open files" active="a.ts"
    onActivate={(id) => activated.push(id)} menu={(id) => <button onClick={() => targeted.push(id)}>Actions for {id}</button>}
    tabs={[{ id: 'a.ts', label: 'a.ts' }, { id: 'b.ts', label: 'b.ts' }]} />, host)
  try {
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Actions for b.ts')!
    trigger.focus()
    trigger.click()
    expect(document.activeElement).toBe(trigger)
    expect(targeted).toEqual(['b.ts'])
    expect(activated).toEqual([])
  } finally { dispose(); host.remove() }
})

it('opens a tab’s menu from the tab by right-click or Shift+F10, without activating it, and focuses it after', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const activated: string[] = []
  const controls = new Map<string, { open: () => boolean; onOpenChange: (open: boolean) => void }>()
  const dispose = render(() => <DocumentTabs idPrefix="editor-ctx" ariaLabel="Open files" active="a.ts"
    onActivate={(id) => activated.push(id)} menu={(id, control) => { controls.set(id, control!); return <span /> }}
    tabs={[{ id: 'a.ts', label: 'a.ts' }, { id: 'b.ts', label: 'b.ts' }]} />, host)
  try {
    const tab = (id: string) => document.getElementById(`editor-ctx-tab-${id}`)!
    const press = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true })
    tab('b.ts').dispatchEvent(press)
    // The right press must not take focus from the document under the strip.
    expect(press.defaultPrevented).toBe(true)
    tab('b.ts').dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }))
    expect(controls.get('b.ts')!.open()).toBe(true)
    expect(controls.get('a.ts')!.open()).toBe(false)
    expect(activated).toEqual([])

    tab('a.ts').dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
    // Opening another replaces it.
    expect(controls.get('a.ts')!.open()).toBe(true)
    expect(controls.get('b.ts')!.open()).toBe(false)
    controls.get('a.ts')!.onOpenChange(false)
    await Promise.resolve()
    expect(document.activeElement).toBe(tab('a.ts'))
    expect(activated).toEqual([])
  } finally { dispose(); host.remove() }
})
