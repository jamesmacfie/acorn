import { createEffect, createMemo, onCleanup } from 'solid-js'
import { registerCommands } from '../registries/commands/commands'
import { registerKeybindings } from '../registries/commands/keybindings'
import type { NavigationHost } from '../registries/commands/navigationCommands'

// One unbound shortcut per workspace, which the person sets in Settings → Keyboard shortcuts.
//
// A shortcut has to aim at a command, so each workspace gets one, kept out of the palette: Switch
// workspace already searches the roster, and a row per workspace would put all of it in the root.
// The id carries the node because a workspace id is unique only within one node.

export const workspaceShortcutId = (nodeId: string, workspaceId: string): string =>
  `workspace.${nodeId}.${workspaceId}.open`

type Row = { id: string; name: string }

export function registerWorkspaceShortcuts(host: Pick<NavigationHost, 'words' | 'workspaces' | 'openWorkspace'>): void {
  const rows = createMemo<Row[]>(
    () =>
      host
        .workspaces()
        .map((entry) => ({ id: workspaceShortcutId(entry.nodeId, entry.workspace.id), name: entry.workspace.name })),
    [],
    // The roster is refetched often. Comparing what a row shows keeps an unchanged one from dropping
    // and re-adding every shortcut.
    {
      equals: (a, b) =>
        a.length === b.length && a.every((row, index) => row.id === b[index].id && row.name === b[index].name),
    },
  )

  createEffect(() => {
    const category = host.words().capitalizedPlural
    const commands = registerCommands(
      rows().map((row) => ({
        id: row.id,
        title: `Go to ${row.name}`,
        category: 'workspace',
        palette: false,
        scope: 'none' as const,
        run: () => {
          // Looked up when the key is pressed, so the open uses the roster's current entry.
          const entry = host
            .workspaces()
            .find((candidate) => workspaceShortcutId(candidate.nodeId, candidate.workspace.id) === row.id)
          if (!entry) throw new Error(`That ${host.words().singular} isn't here any more.`)
          host.openWorkspace(entry)
        },
      })),
    )
    const shortcuts = registerKeybindings(
      rows().map((row) => ({
        id: row.id,
        command: row.id,
        description: `Go to ${row.name}`,
        category,
        defaultChord: '',
        when: 'global' as const,
      })),
    )
    onCleanup(() => {
      shortcuts.dispose()
      commands.dispose()
    })
  })
}
