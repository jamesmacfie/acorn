import { lazy } from 'solid-js'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'

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
