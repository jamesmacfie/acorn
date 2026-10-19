// Re-spelled rather than imported: the namespace is node-core's (server/routes/registry.ts) and
// @acorn/protocol may not name a plugin route, so the client holds its own copy, as the frame scope
// table in frames/scopes.ts does.
export const PLUGIN_NAMESPACE = '/v1/p/'

/** A declarative row may preserve an established origin only inside the namespace of the plugin that
 * supplied it. The exact id covers an origin named after the plugin itself; the colon form leaves room for distinct
 * host-owned subtypes without allowing one plugin to impersonate another. */
export const ownsTaskOrigin = (pluginId: string, origin: string): boolean =>
  origin === pluginId || origin.startsWith(`${pluginId}:`)

/** The normalized Node path a plugin-supplied reference may fetch, or `null`. Stricter than a
 *  descriptor route, because the path arrives in a route answer rather than a parsed manifest: no
 *  credentials, fragment, backslash, control character, or second origin, and dot segments are
 *  resolved before the namespace is checked, so the path fetched is the path checked. */
export function ownedPluginPath(pluginId: string, path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null
  if (/[\\#\u0000- \u007f]/.test(path)) return null
  try {
    const url = new URL(path, 'https://acorn.invalid')
    if (url.origin !== 'https://acorn.invalid' || url.username || url.password) return null
    return url.pathname.startsWith(`${PLUGIN_NAMESPACE}${pluginId}/`) ? `${url.pathname}${url.search}` : null
  } catch {
    return null
  }
}
