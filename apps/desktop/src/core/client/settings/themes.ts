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

// A function, not a const. This used to be a module-load-time array, which read `Registry`'s
// signal outside any reactive scope — so a theme registered by a lazily-activated plugin could
// never appear in the picker, silently. Same shape as STYLES() in uiStyles.ts.
export const THEMES = (): [string, string][] => themeContributions().map((theme) => [theme.id, theme.label])
