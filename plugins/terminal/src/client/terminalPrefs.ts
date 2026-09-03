import type { QueryClient } from '@tanstack/solid-query'
import type { CommandSettingOption } from '@acorn/protocol/commands.ts'
import { PrefKeys, savePref, termFontSize } from '@acorn/plugin-api/client'
import { resolveTerminalFontSize, TERMINAL_FONT_SIZE_OPTIONS } from './preferences'

// The three terminal preferences a person can change, as one reader and one writer each.
//
// Settings → Terminal had all three inline, and the palette is about to offer the same three
// (docs/future/command-palette/phase-3-settings-and-core-commands.md § Migration steps). A setting with
// two persistence paths starts disagreeing with itself, so the defaulting, the option lists and the
// writes live here and both callers use them.
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

// Opt-out: absent means on, matching `contextInjectionEnabled` in
// core/server/worktrees/taskWorktree.ts, which is the thing that acts on it.
export const startupContextInjection = (prefs: TerminalPrefs): boolean =>
  (prefs?.[PrefKeys.startupContextInjection] ?? 'true') !== 'false'
export const saveStartupContextInjection = (qc: QueryClient, on: boolean): Promise<boolean> =>
  savePref(qc, PrefKeys.startupContextInjection, on ? 'true' : 'false')
