import { createEffect, createMemo, onCleanup } from 'solid-js'
import {
  registerCommands,
  type CommandExecutionContext,
  type ContributedCommand,
} from '../../host/registries/commands/commands'
import { registerKeybindings, type KeybindingContribution } from '../../host/registries/commands/keybindings'
import type { SourceEntry } from './railSources'

// "Open <label>" for every source the rail can draw (docs/command-palette-and-shortcuts.md).
//
// Host-owned, so a plugin's source gets a palette row without declaring one, and only one owner ever
// registers the id. Each host passes the sources it can open, so a row disappears the moment its
// plugin unloads, loses trust, or its provider or workspace gate closes, and comes back when it opens.
// How a source opens is the host's: the desktop routes it the way a rail click does, and the terminal
// moves its Menu.

const sourceOpenerId = (sourceId: string): string => `source.${sourceId}.open`

type SourceOpenerRow = SourceEntry & { hidden: boolean }

export function registerSourceOpeners(options: {
  sources: () => readonly SourceEntry[]
  open: (source: SourceEntry, context: CommandExecutionContext) => void
  /** Whether the rail isn't drawing the source. A host with no rail switch leaves it out. */
  hidden?: (sourceId: string) => boolean
  /** Register an unbound shortcut beside each row, which the person can set in Settings → Shortcuts. */
  shortcuts?: boolean
}): void {
  const rows = createMemo<SourceOpenerRow[]>(
    () => options.sources().map((source) => ({ ...source, hidden: options.hidden?.(source.id) ?? false })),
    [],
    // The sources list is rebuilt on every integrations refetch. Comparing what a row shows keeps an
    // unchanged list from dropping and re-adding every command and shortcut.
    {
      equals: (a, b) =>
        a.length === b.length &&
        a.every(
          (row, index) => row.id === b[index].id && row.label === b[index].label && row.hidden === b[index].hidden,
        ),
    },
  )

  createEffect(() => {
    const commands = registerCommands(
      rows().map((row): ContributedCommand => ({
        id: sourceOpenerId(row.id),
        title: `Open ${row.label}`,
        ...(row.hidden ? { hint: 'hidden from the left rail' } : {}),
        keywords: [row.label, 'rail', 'source'],
        category: 'navigation',
        palette: true,
        scope: 'none',
        run: (context) => options.open(row, context),
      })),
    )
    const shortcuts = options.shortcuts
      ? registerKeybindings(
          rows().map((row): KeybindingContribution => ({
            id: sourceOpenerId(row.id),
            command: sourceOpenerId(row.id),
            description: `Open ${row.label}`,
            category: 'Rail',
            defaultChord: '',
            when: 'global',
          })),
        )
      : undefined
    onCleanup(() => {
      shortcuts?.dispose()
      commands.dispose()
    })
  })
}
