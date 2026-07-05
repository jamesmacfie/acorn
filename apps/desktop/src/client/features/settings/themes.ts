// value → label for the Appearance theme pickers. Must list exactly the themes
// styles/tokens-layout.css defines ('light' is the :root default; every other value has a
// `:root[data-theme="…"]` block) — themes.test.ts guards the two against drifting.
export const THEMES: [string, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['solarized-light', 'Solarized Light'],
  ['solarized-dark', 'Solarized Dark'],
  ['monokai', 'Monokai'],
  ['nord', 'Nord'],
  ['catppuccin-latte', 'Catppuccin Latte'],
  ['catppuccin-frappe', 'Catppuccin Frappé'],
  ['catppuccin-macchiato', 'Catppuccin Macchiato'],
  ['catppuccin-mocha', 'Catppuccin Mocha'],
  ['one-dark', 'One Dark'],
  ['dracula', 'Dracula'],
]
