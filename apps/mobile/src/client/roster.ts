import { createSignal } from 'solid-js'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints'

// The built-in plugins register after the first frame, as on the desktop and in the terminal, because
// ./plugins.ts imports every plugin's panes and sources. Every registry is a Solid signal, so what
// is on screen fills in when they land. `rosterReady` says they have, for the one choice that can't
// wait for a signal to fill in: which pane a task opens on.
const [rosterReady, setRosterReady] = createSignal(false)
export { rosterReady }

export async function installRoster(): Promise<void> {
  const { clientPlugins } = await import('./plugins')
  initClientPlugins(clientPlugins)
  setRosterReady(true)
}
