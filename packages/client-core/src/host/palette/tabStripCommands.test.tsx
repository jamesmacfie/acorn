import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import { Tabs } from '../../kit/components/layout/Tabs'
import { commandAvailable, commandRegistry, commandTitle, executeCommand } from '../registries/commands/commands'
import { registerTabStripCommands } from './tabStripCommands'

const tabRows = () => commandRegistry.entries().filter((command) => command.id.startsWith('core.tabs.'))

it('offers a palette row for each tab on screen except the open one, and picks the tab', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const [active, setActive] = createSignal('details')
  const [count, setCount] = createSignal(1)
  const dispose = render(() => {
    registerTabStripCommands()
    return (
      <Tabs
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'conversation', label: 'Conversation', count: count() },
        ]}
        active={active()}
        onChange={setActive}
        idPrefix="pull"
        ariaLabel="Pull request"
      />
    )
  }, host)
  // jsdom lays nothing out, so the strip has to be told it is drawn.
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  try {
    expect(tabRows().map(commandTitle)).toEqual(['Show Details tab', 'Show Conversation tab'])
    const conversation = tabRows()[1]
    expect(tabRows().map((command) => commandAvailable(command))).toEqual([false, true])

    // A count moving keeps the same registration.
    setCount(2)
    expect(tabRows()[1]).toBe(conversation)

    await executeCommand(conversation.id)
    expect(active()).toBe('conversation')
    // Focus goes with it, so the palette does not hand it back to the tab that was open.
    expect(document.activeElement?.textContent).toContain('Conversation')

    // A strip that is mounted but not drawn offers nothing.
    rects.mockReturnValue([] as unknown as DOMRectList)
    expect(tabRows().some((command) => commandAvailable(command))).toBe(false)
  } finally {
    rects.mockRestore()
    dispose()
    host.remove()
  }
  expect(tabRows()).toEqual([])
})
