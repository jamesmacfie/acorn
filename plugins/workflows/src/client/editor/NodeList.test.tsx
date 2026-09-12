import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { newDraft } from './draft'
import NodeList from './NodeList'

// The list in jsdom, for one claim: a mouse press picks a row. A `Row` inside a `Rows` collection
// has no click of its own unless the body gives it one — `onSelect` and `onActivate` are the
// keyboard's — so this list was arrow-keys-only and nothing happened when anybody clicked it
// (client-core kit/components/primitives.tsx § Row).

const def: WorkflowDef = {
  name: 'PR review',
  steps: [
    { name: 'understand-pr', kind: 'agent', with: { prompt: 'read it' } },
    { name: 'bug-review', kind: 'agent', after: ['understand-pr'], with: { prompt: 'find bugs' } },
  ],
} as unknown as WorkflowDef

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('the node list', () => {
  it('selects the row that was clicked', () => {
    const onSelect = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => (
      <NodeList
        draft={newDraft(def)}
        catalog={undefined}
        onSelect={onSelect}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    ), host)

    const rows = [...host.querySelectorAll<HTMLElement>('.ui-row')]
    const labels = rows.map((row) => row.textContent)
    expect(labels[0]).toContain('Definition')
    expect(labels[1]).toContain('Inputs')

    rows[0].click()
    expect(onSelect).toHaveBeenCalledWith({ kind: 'definition' })
    rows[1].click()
    expect(onSelect).toHaveBeenCalledWith({ kind: 'inputs' })

    const node = rows.find((row) => row.textContent?.includes('bug-review'))
    node?.click()
    expect(onSelect).toHaveBeenCalledWith({ kind: 'node', name: 'bug-review' })

    host.remove()
  })
})
