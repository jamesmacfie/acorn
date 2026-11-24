import { describe, expect, it, vi } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import type { Workspace } from '@acorn/protocol/api.ts'
import { commandRegistry } from '../registries/commands/commands'
import { keybindingRegistry, resolveKeybindings } from '../registries/commands/keybindings'
import { workspaceWords } from '../../features/workspaces/words'
import { registerWorkspaceShortcuts, workspaceShortcutId } from './workspaceShortcuts'

// One unbound shortcut per workspace, off the palette, that follows the roster in and out and opens
// the entry the roster holds when the key is pressed.
describe('workspace shortcuts', () => {
  const entry = (nodeId: string, id: string, name: string) => ({
    nodeId,
    workspace: { id, name, projects: [] } as unknown as Workspace,
  })

  it('registers an unbound shortcut per workspace, and leaves with it', () => {
    const openWorkspace = vi.fn()
    const [workspaces, setWorkspaces] = createSignal([entry('a', 'w1', 'Acorn'), entry('b', 'w1', 'Runn')])
    const dispose = createRoot((dispose) => {
      registerWorkspaceShortcuts({ words: () => workspaceWords('on'), workspaces, openWorkspace })
      return dispose
    })
    const acorn = workspaceShortcutId('a', 'w1')
    const runn = workspaceShortcutId('b', 'w1')

    const shortcuts = resolveKeybindings(keybindingRegistry.entries()).filter((b) => b.category === 'Workspaces')
    expect(shortcuts.map((b) => [b.id, b.description, b.chord])).toEqual([
      [acorn, 'Go to Acorn', null],
      [runn, 'Go to Runn', null],
    ])
    expect(
      resolveKeybindings(keybindingRegistry.entries(), { keybindings: JSON.stringify({ [runn]: 'meta+2' }) }).find(
        (b) => b.id === runn,
      )?.chord,
    ).toBe('meta+2')
    expect(commandRegistry.get(runn)?.palette).toBe(false)

    // A rename keeps the binding id, and the open uses the renamed entry.
    const renamed = entry('b', 'w1', 'Runn app')
    setWorkspaces([entry('a', 'w1', 'Acorn'), renamed])
    ;(commandRegistry.get(runn) as unknown as { run: () => void }).run()
    expect(openWorkspace).toHaveBeenCalledWith(renamed)

    setWorkspaces([entry('a', 'w1', 'Acorn')])
    expect(keybindingRegistry.get(runn)).toBeUndefined()
    expect(commandRegistry.get(runn)).toBeUndefined()

    dispose()
    expect(keybindingRegistry.get(acorn)).toBeUndefined()
    expect(commandRegistry.get(acorn)).toBeUndefined()
  })
})
