import type { QueryClient } from '@tanstack/solid-query'
import type { CommandSettingOption } from '@acorn/protocol/commands.ts'
import { PrefKeys, savePref, termFontSize } from '@acorn/plugin-api/client'
import { resolveTerminalFontSize, TERMINAL_FONT_SIZE_OPTIONS } from './preferences'

// The two terminal preferences a person can change, as one reader and one writer each. Whether a new
// agent session is sent the task's context was a third; it is core's preference, and its switch and
// accessor moved to the agents plugin's Harnesses and defaults page
// (plugins/agents/src/client/settings/startupContext.ts).
//
// Settings → Terminal had them inline. A value with two persistence paths starts disagreeing
// with itself, so the defaulting, the option lists and the writes live here and every caller uses
// them. There is no `setting` command over these two yet, and that is the point of extracting the
// accessor before there is: one registered later cannot become a second writer
// (docs/terminal.md § From the command palette).
//
// Beside `./preferences.ts` rather than inside it, because that file is the pure half — the font-size
// bounds and the line height xterm measures with — and it is imported by a bare-Node test. This half
// reaches the query client, so it stays out of that path.

/** The prefs map as `prefsOptions` hands it over: absent while the first read is in flight. */
export type TerminalPrefs = Record<string, string> | undefined

/** What the terminal button opens into when the drawer is empty. `TerminalPanel` reads the same key. */
export const TERMINAL_RAIL_DEFAULT_CHOICES: readonly CommandSettingOption[] = [
  { value: 'empty', label: 'Empty (pick a profile with +)' },
  { value: 'shell', label: 'Shell' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
]

export const terminalRailDefault = (prefs: TerminalPrefs): string => prefs?.[PrefKeys.terminalRailDefault] ?? 'empty'
export const saveTerminalRailDefault = (qc: QueryClient, value: string): Promise<boolean> =>
  savePref(qc, PrefKeys.terminalRailDefault, value)

/** The stored size, falling back to whatever the shell's own token says when nothing valid is stored. */
export const terminalFontSize = (prefs: TerminalPrefs): number =>
  resolveTerminalFontSize(prefs?.[PrefKeys.terminalFontSize], termFontSize())
export const saveTerminalFontSize = (qc: QueryClient, value: string): Promise<boolean> =>
  savePref(qc, PrefKeys.terminalFontSize, value)

export const terminalFontSizeChoices = (): CommandSettingOption[] =>
  TERMINAL_FONT_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size}px${size === 15 ? ' (default)' : ''}` }))
