import { lazy } from 'solid-js'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'

// CORE's rail sources, and there is exactly one: Fleet home.
//
// It is a source rather than a route for the same reason github's browse became one in Phase 3 — the
// shell's `<Switch>` renders whatever the selected source contributes, and anything else would mean the
// shell knowing about this surface by name.
//
// `order: 0` puts it ahead of github (10), which is right when it is visible at all: the fleet is the
// outer scope. `when` is what keeps it invisible otherwise — ui.md § New surfaces: "With only the bundled
// local node, this view stays out of the way; first-run never mentions nodes at all." A component that
// rendered an empty state would still leave a rail button asking about a concept the owner has not met.
const FleetHome = lazy(() => import('@acorn/client-core/node/FleetHome.tsx'))

export const coreSourceContributions: SourceContribution[] = [
  {
    id: 'fleet',
    order: 0,
    glyph: 'network',
    label: 'Fleet',
    when: () => nodes().length > 1,
    component: FleetHome,
  },
]
