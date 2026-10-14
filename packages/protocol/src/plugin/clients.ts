// Which client apps a plugin's client half runs in (docs/plugin-authoring/the-manifest.md § Which apps it runs in).
//
// The manifest's `clients` list accepts any string, so an app a later build adds is reported as unknown
// rather than failing the manifest. A value this build doesn't know never matches, so a plugin that lists
// only such values runs in neither app here.
export const PLUGIN_CLIENTS = ['desktop', 'terminal'] as const
export type PluginClient = (typeof PLUGIN_CLIENTS)[number]

/** Whether a declaration runs in this app. A declaration with no `clients` list runs in every app. */
export const runsIn = (declaration: { clients?: readonly string[] } | undefined, app: PluginClient): boolean =>
  !declaration?.clients || declaration.clients.includes(app)

/** The plugin list's note for a plugin that this app leaves out. */
export function clientsNote(clients: readonly string[]): string {
  const known = PLUGIN_CLIENTS.filter((app) => clients.includes(app))
  return known.length === 1
    ? `Runs in the ${known[0]} app only.`
    : 'Runs only in apps this version of Acorn doesn’t have.'
}
