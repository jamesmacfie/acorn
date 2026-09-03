import type { QueryClient } from '@tanstack/solid-query'
import type { CommandSettingOption } from '@acorn/protocol/commands.ts'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { resolveTheme, THEMES } from './builtInThemes'
import { savePref } from './savePref'
import { DEFAULT_STYLE, STYLES } from './uiStyles'

// The five appearance choices, as one reader and one writer each.
//
// The rule this file exists for: a setting a person can change from two places has one accessor, and
// both places call it (docs/future/command-palette/architecture.md § Settings integration). Settings →
// Appearance had all five inline, so a palette command would have been a second copy of the defaulting
// (`terminal` when nothing is stored, follow-the-OS until a theme is picked), a second copy of
// `resolveTheme`, and a second `savePref` call to keep in step. Two persistence paths for one value is
// how a setting quietly starts disagreeing with itself.
//
// The two axes stay disjoint (docs/ui-design.md § Token axes): style owns shape, typography, spacing
// and density; theme owns colour. Theme additionally has a follow-the-OS mode with one pick per mode,
// which is why there are three theme readers and not one.
//
// Both lists are functions and not constants, because a plugin may contribute a theme or a style and
// the registries are signals: a caller that snapshotted either would stop offering what the reader has
// installed.

/** The prefs map as `prefsOptions` hands it over: absent while the first read is in flight. */
export type AppearancePrefs = Record<string, string> | undefined

export const appearanceStyle = (prefs: AppearancePrefs): string => prefs?.[PrefKeys.style] ?? DEFAULT_STYLE
export const saveAppearanceStyle = (qc: QueryClient, value: string): Promise<boolean> =>
  savePref(qc, PrefKeys.style, value)

/** Follow the OS until the reader has explicitly picked a theme, and then only if they said so. */
export const themeFollowsSystem = (prefs: AppearancePrefs): boolean =>
  (prefs?.[PrefKeys.themeFollowSystem] ?? (prefs?.[PrefKeys.theme] ? 'false' : 'true')) === 'true'
export const saveThemeFollowsSystem = (qc: QueryClient, follow: boolean): Promise<boolean> =>
  savePref(qc, PrefKeys.themeFollowSystem, follow ? 'true' : 'false')

// All three reads go through `resolveTheme`, so what is shown is the theme that is actually on screen
// rather than a stored id whose plugin has gone away (./builtInThemes.ts says why the pref is left
// alone in that case).
export const fixedTheme = (prefs: AppearancePrefs): string => resolveTheme(prefs?.[PrefKeys.theme], 'light')
export const saveFixedTheme = (qc: QueryClient, id: string): Promise<boolean> => savePref(qc, PrefKeys.theme, id)

export const lightTheme = (prefs: AppearancePrefs): string => resolveTheme(prefs?.[PrefKeys.themeLight], 'light')
export const saveLightTheme = (qc: QueryClient, id: string): Promise<boolean> => savePref(qc, PrefKeys.themeLight, id)

export const darkTheme = (prefs: AppearancePrefs): string => resolveTheme(prefs?.[PrefKeys.themeDark], 'dark')
export const saveDarkTheme = (qc: QueryClient, id: string): Promise<boolean> => savePref(qc, PrefKeys.themeDark, id)

/** What the page's `<Select>` and a setting command's choices are both built from. */
export const themeChoices = (): CommandSettingOption[] => THEMES().map(([value, label]) => ({ value, label }))
export const styleChoices = (): CommandSettingOption[] => STYLES().map(([value, label]) => ({ value, label }))
