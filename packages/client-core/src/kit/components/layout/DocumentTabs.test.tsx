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
