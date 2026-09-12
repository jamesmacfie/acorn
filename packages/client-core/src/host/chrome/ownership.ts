/** A declarative row may preserve an established origin only inside the namespace of the plugin that
 * supplied it. The exact id covers legacy provider origins; the colon form leaves room for distinct
 * host-owned subtypes without allowing one plugin to impersonate another. */
export const ownsTaskOrigin = (pluginId: string, origin: string): boolean =>
  origin === pluginId || origin.startsWith(`${pluginId}:`)
