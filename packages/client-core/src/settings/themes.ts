import { themeContributions, themeRegistry, type ThemeContribution } from '../registries/themes'

const builtInThemes: ThemeContribution[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'nord', label: 'Nord' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte' },
  { id: 'catppuccin-frappe', label: 'Catppuccin Frappé' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'dracula', label: 'Dracula' },
]

if (!themeRegistry.entries().length) for (const theme of builtInThemes) themeRegistry.register(theme)

export const THEMES = (): [string, string][] => themeContributions().map((theme) => [theme.id, theme.label])

/**
/**
 * The theme to actually apply for a stored preference.
 *
 * A plugin theme's definition lives with the plugin, so the pref can outlive it: the package is
 * disabled, uninstalled, its client bundle stops being trusted, its node is unreachable, or the
 * author renames the theme. Applying an unknown id would set `data-theme` to a value no block
 * matches, which renders the `:root` default palette while `--is-dark` says whatever the OS media
 * block last said: a half-applied theme rather than a missing one.
 *
 * So the read falls back and the write is left alone. Nothing here clears the pref: "the owning
 * plugin is gone" and "the node is having a bad minute" arrive at this function as exactly the same
 * absence, and a pref erased on the second one cannot be recovered when the node comes back. A user
 * who sees Light for a minute and their own theme afterwards has lost nothing; a user whose choice
 * was deleted has to go and find it again.
 *
 * Reactive: it reads the registry signal, so the effect in persistence/appStartup.ts that calls it
 * re-runs when the chrome pass registers or disposes a plugin theme.
 */
export const resolveTheme = (id: string | undefined, fallback: string): string =>
  id && themeRegistry.get(id) ? id : fallback
