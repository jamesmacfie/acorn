import type { PluginContributions } from '@acorn/protocol/api.ts'

// Binding a loaded plugin's pane, source and slot ids to its own name.
//
// Contribution ids are un-namespaced by design: `pr`, `changes` and `terminal.drawer` double as
// persisted layout keys and chord targets, so they cannot carry an arbitrary prefix
// (registries/plugin.ts). Plugin-versus-plugin collisions fail loudly, which is fine. The one that
// does not is a collision with a *future core id*: core adds a pane called `notes`, an installed
// plugin already registered one, and core loses a first-come race against a package the owner
// installed. Nothing anywhere announces it.
//
// So a loaded plugin's ids have to sit inside its own namespace. What counts as inside is the shape
// the first-party packages already use — `database`, `http-requests`, `linear-issue` — rather than a
// prefix invented here, and that is the whole reason this is cheap: every id that has ever shipped
// already passes, so nothing in anyone's saved layout moves and no alias map is needed. An id that
// does not pass is prefixed, which only ever happens to a package written after this rule.
//
// Compiled plugins are untouched. They are the app: an id they collide with core on is a duplicate
// registration that fails in `pnpm test`, not a race decided by install order.
//
// The rewrite happens once, where the device reads the roster row (./contributions.ts), so every
// consumer downstream sees one spelling: the registries, the `openPane` allowlist, the
// extension-point bindings, the content-link router. Doing it at each registration site would be the
// same change made in eleven places and wrong in whichever one got missed.

/** Is this id already inside the plugin's namespace? The id itself, or `<id>-…`, or `<id>.…`. */
export const isOwnNamespace = (pluginId: string, id: string): boolean =>
  id === pluginId || id.startsWith(`${pluginId}-`) || id.startsWith(`${pluginId}.`)

export const qualifiedContributionId = (pluginId: string, id: string): string =>
  isOwnNamespace(pluginId, id) ? id : `${pluginId}.${id}`

/** The keys whose value is a reference to a declared surface, wherever they appear in a manifest:
 *  `action.pane`, `action.surface`, `action.overlay`, `routes[].surface`, `contentLinks[].pane`,
 *  `extensionPoints[].surface`. Matching on the key name rather than on a list of paths, so a
 *  descriptor that gains a reference is covered without anyone remembering to come back here.
 *
 *  `frame` belongs here too: an `extensions` entry places one of this plugin's own `inline` surfaces in
 *  another plugin's rectangle point, so a surface id rewritten below has to be rewritten in the
 *  reference with it.
 *
 *  Deliberately not `slot`, which names one of the host's own slots, and not `point`, which names
 *  another plugin's extension point. */
const REFERENCE_KEYS = new Set(['pane', 'surface', 'overlay', 'frame'])

/** The contribution lists whose `id` is a name this device registers bare, and so a name core could one
 *  day collide with.
 *
 *  Not `extensions`: a contribution's id reaches the registry as `plugin:<pluginId>:<id>` already
 *  (chrome/extensionPoints.ts), so it cannot collide with core's or another package's, and prefixing it
 *  here would namespace it twice. */
const NAMESPACED_KINDS = ['frames', 'sources', 'slots'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Rewrite every declared frame, source and slot id that is outside the plugin's namespace, and every
 *  reference to one.
 *
 * Returns the input untouched when every id already passes, which is the case for all five packages
 * that ship today. */
export function namespaceContributions(pluginId: string, contributions: PluginContributions): PluginContributions {
  const declared = new Map<string, string>()
  for (const kind of NAMESPACED_KINDS) {
    for (const entry of contributions[kind] ?? []) {
      if (!isOwnNamespace(pluginId, entry.id)) declared.set(entry.id, `${pluginId}.${entry.id}`)
    }
  }
  if (declared.size === 0) return contributions

  const rewrite = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry))
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)]))
    if (typeof value === 'string' && key !== undefined && REFERENCE_KEYS.has(key)) return declared.get(value) ?? value
    return value
  }

  const next = rewrite(contributions) as PluginContributions
  for (const kind of NAMESPACED_KINDS) {
    for (const entry of next[kind] ?? []) {
      const qualified = declared.get(entry.id)
      if (qualified) entry.id = qualified
    }
  }
  return next
}
