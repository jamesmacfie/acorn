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
