import type { BrowserApi } from '../browser'

// The panel's theme and style pack. It loads the app's own token stylesheets (see main.tsx) and
// picks a block in them the way the app does, with `data-theme` and `data-style` on <html>. The app
// keeps its choice as a device preference this extension can't read, so the panel keeps its own.
// docs/browser-extension/setup.md#appearance.

// The app's built-in themes and style packs, the blocks in tokens-theme.css and the style-*.css packs.
export const THEMES: readonly (readonly [id: string, label: string])[] = [
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
export const STYLES: readonly (readonly [id: string, label: string])[] = [
  ['terminal', 'Terminal'],
  ['modern', 'Modern'],
  ['cozy', 'Cozy'],
  ['cute', 'Cute'],
]

// `theme` is null to follow the system's light or dark.
export type Appearance = { theme: string | null; style: string }

const APPEARANCE_KEY = 'appearance'

export async function loadAppearance(storage: BrowserApi['storage']['local']): Promise<Appearance> {
  const stored = (await storage.get([APPEARANCE_KEY]))[APPEARANCE_KEY] as Partial<Appearance> | undefined
  const known = (list: typeof THEMES, id: unknown) => list.some(([known]) => known === id)
  return {
    theme: known(THEMES, stored?.theme) ? stored!.theme! : null,
    style: known(STYLES, stored?.style) ? stored!.style! : 'terminal',
  }
}

export const saveAppearance = (storage: BrowserApi['storage']['local'], appearance: Appearance): Promise<void> =>
  storage.set({ [APPEARANCE_KEY]: appearance })

// With no `data-theme`, the theme sheet's own media query picks light or dark. Every open panel
// follows a change made in any of them.
export async function followAppearance(api: BrowserApi, root: Pick<HTMLElement, 'dataset'>): Promise<void> {
  const apply = (appearance: Appearance) => {
    if (appearance.theme) root.dataset.theme = appearance.theme
    else delete root.dataset.theme
    root.dataset.style = appearance.style
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && APPEARANCE_KEY in changes) void loadAppearance(api.storage.local).then(apply)
  })
  apply(await loadAppearance(api.storage.local))
}
