// Where a settings page sits and what it affects. A contract both sides read: the node reports a
// settings frame whose manifest names a value outside these lists, and the client places a page by
// them, whether it arrived compiled or inside a roster row.
//
// The group list is closed. A plugin places a page in one of six groups; the other three hold core's
// own pages, because each is a surface core draws around every plugin (workspaces and their projects,
// the plugin list, and the device's own tools).

/** Every rail group, in the order the rail draws them. */
export const SETTINGS_CATEGORIES = [
  'general', 'workspaces', 'agents', 'connections', 'features', 'automation', 'machines', 'plugins', 'advanced',
] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

/** The groups a plugin may place a page in. A page that names none lands in `features`. */
export const PLUGIN_SETTINGS_CATEGORIES = [
  'general', 'agents', 'connections', 'features', 'automation', 'machines',
] as const satisfies readonly SettingsCategory[]
export type PluginSettingsCategory = (typeof PLUGIN_SETTINGS_CATEGORIES)[number]

/** What a change on the page affects. A page that names none is a node page. */
export const SETTINGS_SCOPES = ['device', 'node', 'workspace', 'project'] as const
export type SettingsScope = (typeof SETTINGS_SCOPES)[number]

/** The most search keywords a page, or one of its sections, may declare, and the most sections. Search
 *  and deep links are what these are for, and a page with more than sixteen sections is a page that
 *  wants splitting. */
export const SETTINGS_SEARCH_MAX = 16

/** A section id is the part of a deep link after `#`, so it is a word a link can carry. */
export const SETTINGS_SECTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const isPluginSettingsCategory = (value: unknown): value is PluginSettingsCategory =>
  (PLUGIN_SETTINGS_CATEGORIES as readonly unknown[]).includes(value)

export const isSettingsScope = (value: unknown): value is SettingsScope =>
  (SETTINGS_SCOPES as readonly unknown[]).includes(value)

/** The most rail sources one settings page may carry a **Show in left rail** switch for. */
export const RAIL_SOURCE_VISIBILITY_MAX = 16

/** The ids in a page's `railSourceVisibility` that do not name one of `ownSources`, the sources the
 *  same plugin declares. The host draws a switch only for a plugin's own source, so a core source or
 *  another plugin's is refused at compiled registration and reported by the node's manifest reader. */
export const foreignRailSources = (ids: readonly string[], ownSources: readonly string[]): string[] =>
  ids.filter((id) => !ownSources.includes(id))
