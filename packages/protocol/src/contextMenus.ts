// Where a right-click lands, and what a menu item may ask about it. See docs/plugins.md § Context
// menus.

/** Every place a right-click opens a host-drawn menu. */
export const CONTEXT_MENU_LOCATIONS = ['task.row'] as const

export type ContextMenuLocation = (typeof CONTEXT_MENU_LOCATIONS)[number]

export const isContextMenuLocation = (value: unknown): value is ContextMenuLocation =>
  typeof value === 'string' && (CONTEXT_MENU_LOCATIONS as readonly string[]).includes(value)

/**
 * The facts a `when` may name, per location. A strict subset of what the host puts on the target: the
 * identity fields (`id`, `title`) are absent because a menu item keyed to one task id is not an
 * extension point, and free text (`branch`) is absent because matching it exactly is a trap rather
 * than a feature.
 *
 * Declared here rather than derived from the target type, because the target type is a client type
 * and this list is what the node checks a manifest against.
 */
export const CONTEXT_MENU_FACTS: Readonly<Record<ContextMenuLocation, readonly string[]>> = {
  // `origin` is the task's origin ('local', 'github', …), `pinned` its rail-order state.
  'task.row': ['origin', 'projectId', 'pinned'],
}

/** A declared `when`: every named fact must equal the value given. */
export type ContextMenuWhen = Readonly<Record<string, string | boolean>>

/** The `when` keys this location does not have a fact for. Non-empty means refuse: an item whose
 *  predicate names a fact the host never supplies can never match, so it would install and do
 *  nothing. */
export const unknownWhenFacts = (location: ContextMenuLocation, when: ContextMenuWhen): string[] =>
  Object.keys(when).filter((fact) => !CONTEXT_MENU_FACTS[location].includes(fact))

/**
 * Does this target satisfy the declared `when`? Absent or empty means "always", and every named fact
 * must be strictly equal, with no coercion, so `pinned: 'true'` does not match `pinned: true`. The
 * strict comparison is why the manifest types a fact as `string | boolean` rather than `unknown`.
 */
export const matchesWhen = (when: ContextMenuWhen | undefined, target: Record<string, unknown>): boolean =>
  !when || Object.entries(when).every(([fact, value]) => target[fact] === value)
