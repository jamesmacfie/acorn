import type { PluginClient } from '@acorn/protocol/plugin/clients.ts'

// Which app this client is. The host says so once at startup (../clientRuntime.ts), before the first
// plugin pass. Desktop until then, which is also what a test that never starts a runtime gets.
let app: PluginClient = 'desktop'

export const clientApp = (): PluginClient => app

export const setClientApp = (next: PluginClient): void => {
  app = next
}
