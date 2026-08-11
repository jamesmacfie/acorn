import { createSignal } from 'solid-js'

// Which plugin overlay is on screen (docs/plugins.md § Frame contribution kind).
//
// ONE at a time, and a plain signal rather than a registry: an overlay covers the window, so "two open"
// is not a state the surface has — the second would hide the first and the reader would have no way to
// tell which Escape dismissed. Opening a second one replaces the first, the same way the shell's own
// palettes behave.
//
// Kept out of the registries folder and JSX-free deliberately: the verb that opens an overlay lives in
// plugins/chrome/actions.ts and the surface that renders one in plugins/frames/register.tsx, and both
// have unit tests that run in a bare Node environment with no Solid transform (registries/slots.ts
// states the same split).
const [current, setCurrent] = createSignal<{ pluginId: string; surface: string } | null>(null)

export const openPluginOverlay = (pluginId: string, surface: string): void => void setCurrent({ pluginId, surface })

export const closePluginOverlay = (): void => void setCurrent(null)

export const pluginOverlayOpen = (pluginId: string, surface: string): boolean => {
  const open = current()
  return open?.pluginId === pluginId && open.surface === surface
}
