import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import RowControls from './RowControls'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.replaceChildren() })

it('offers focusable row-menu moves and names a refused choice', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const onMove = vi.fn()
  dispose = render(() => <RowControls row={{ id: 'one', pluginId: 'github', sourceId: 'pulls', values: {} }}
    boardChoices={[{ id: 'closed', label: 'Closed' }, { id: 'merged', label: 'Merged' }]}
    boardMoveReason={(_row, choice) => choice === 'merged' ? 'No write value for GitHub here.' : undefined}
    onBoardMove={onMove} />, host)

  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
  trigger.focus()
  trigger.click()
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(items.map(item => item.textContent)).toContain('Move to Merged: No write value for GitHub here.')
  const closed = items.find(item => item.textContent === 'Move to Closed')!
  closed.focus()
  expect(document.activeElement).toBe(closed)
  closed.click()
  expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }), 'closed')
})
