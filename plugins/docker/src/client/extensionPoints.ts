// The two places another plugin may draw inside Docker's surfaces (docs/plugins.md § Cooperative
// extension points). The host mints the qualified ids from the bare ones below.

/** Room beside the live numbers on a container's Stats tab: a graph, a cost estimate, a quota. */
export const STATS_BESIDE_POINT = 'docker:stats-beside'

/** What another plugin knows about a container the browse list is already drawing, keyed by its id. */
export const CONTAINER_POINT = 'docker:container'
export const CONTAINER_KEY = ['container'] as const
