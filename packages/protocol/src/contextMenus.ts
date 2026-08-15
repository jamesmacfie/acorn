// Where a right-click lands, and what a declared menu item may ask about it — a contract both sides
// read, for the same reason `themeTokens.ts` is one: the node has to reject a bad `contextMenus` entry
// at parse time, the client has to re-check the same entry when it arrives inside a roster row, and
// the node cannot import the client.
//
// THE LOCATION VOCABULARY GROWS WITH ITS HOSTS, never ahead of them. A location listed here that no
// surface actually renders would be a contribution that parses and then silently never appears, which
// is the failure `pluginManifest.ts` spends most of its length refusing. `task.row` is here because
// the tab rail's task row renders this registry today — core's own Pin/Rename/Archive items come from
// it, so the contract has a consumer before the first plugin touches it.
//
// WHY A `when` IS A MAP AND NOT AN EXPRESSION. A manifest is data. A predicate that could be written
// as an expression would need a parser, an evaluator and a decision about what it may call; a map of
// literals that must all equal the target's own facts needs none of that and covers the case menu
// items actually have ("only on a pinned row", "only on a github task"). Widening it later is
// additive; shipping a small language is not reversible.

/** Every place a right-click opens a host-drawn menu. */
export const CONTEXT_MENU_LOCATIONS = ['task.row'] as const

export type ContextMenuLocation = (typeof CONTEXT_MENU_LOCATIONS)[number]

export const isContextMenuLocation = (value: unknown): value is ContextMenuLocation =>
  typeof value === 'string' && (CONTEXT_MENU_LOCATIONS as readonly string[]).includes(value)

/**
 * The facts a `when` may name, per location. A STRICT SUBSET of what the host puts on the target: the
 * identity fields (`id`, `title`) are deliberately absent, because a menu item keyed to one task id is
 * not an extension point, and free text (`branch`) is absent because matching it exactly is a trap
 * rather than a feature.
 *
 * Declared here rather than derived from the target type, because the target type is a client type and
 * this list is what the NODE checks a manifest against.
 */
export const CONTEXT_MENU_FACTS: Readonly<Record<ContextMenuLocation, readonly string[]>> = {
  // `origin` is the task's origin ('local', 'github', …), `pinned` its rail-order state.
  'task.row': ['origin', 'projectId', 'pinned'],
}

/** A declared `when`: every named fact must equal the value given. */
export type ContextMenuWhen = Readonly<Record<string, string | boolean>>

/** The `when` keys this location does not have a fact for. Non-empty means refuse — an item whose
 *  predicate names a fact the host never supplies can never match, so it would install and do
 *  nothing. */
export const unknownWhenFacts = (location: ContextMenuLocation, when: ContextMenuWhen): string[] =>
  Object.keys(when).filter((fact) => !CONTEXT_MENU_FACTS[location].includes(fact))

/**
 * Does this target satisfy the declared `when`? Absent or empty means "always", and every named fact
 * must be strictly equal — no coercion, so `pinned: 'true'` does not match `pinned: true`. The strict
 * comparison is why the manifest types a fact as `string | boolean` rather than `unknown`.
 */
export const matchesWhen = (when: ContextMenuWhen | undefined, target: Record<string, unknown>): boolean =>
  !when || Object.entries(when).every(([fact, value]) => target[fact] === value)
