import { createEffect, createMemo, onCleanup } from 'solid-js'
import { liveTabStrips, type LiveTabStrip } from '../../kit/keys/tabStrips'
import { registerCommands, type ContributedCommand } from '../registries/commands/commands'

// A "Show <tab> tab" row for every tab of every strip on screen, so a reader can type "conversation"
// and land on a pull request's Conversation tab. Every kit `Tabs` publishes itself
// (kit/keys/tabStrips.ts), so a plugin gets these rows without registering anything.
//
// Registered for every mounted strip and gated on whether it is drawn, because panes and tab panels
// stay mounted while hidden. Called from the command palette, which lives as long as the window.

type TabRow = { strip: LiveTabStrip; id: string; label: string }

export function registerTabStripCommands(): void {
  const rows = createMemo<TabRow[]>(
    () => liveTabStrips().flatMap((strip) => strip.tabs().map((tab) => ({ strip, id: tab.id, label: tab.label }))),
    [],
    // A change request rebuilds its tab list whenever a count moves. Comparing what a row shows keeps
    // that from dropping and re-adding every command.
    {
      equals: (a, b) =>
        a.length === b.length &&
        a.every((row, index) => row.strip === b[index].strip && row.id === b[index].id && row.label === b[index].label),
    },
  )

  createEffect(() => {
    const commands = registerCommands(
      rows().map((row): ContributedCommand => ({
        id: `core.tabs.${row.strip.key}.${row.id}`,
        title: `Show ${row.label} tab`,
        hint: row.strip.label,
        keywords: [row.label, 'tab'],
        category: 'navigation',
        palette: true,
        scope: 'none',
        when: () => row.strip.shown() && row.strip.active() !== row.id,
        run: () => row.strip.select(row.id),
      })),
    )
    onCleanup(() => commands.dispose())
  })
}
