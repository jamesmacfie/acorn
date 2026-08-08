import { lazy } from 'solid-js'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'

const Home = lazy(() => import('@acorn/client-core/workspaces/Home.tsx'))
const FleetHome = lazy(() => import('@acorn/client-core/node/FleetHome.tsx'))

export const coreSourceContributions: SourceContribution[] = [
  {
    id: 'home',
    order: 0,
    glyph: 'home',
    label: 'Home',
    isDefault: true,
    component: Home,
    routes: [
      { id: 'core.project', path: '/p/:projectId', kind: 'project', order: 10 },
      { id: 'core.create-task', path: '/p/:projectId/new', kind: 'create', order: 20 },
    ],
  },
  {
    id: 'fleet',
    order: 1,
    glyph: 'network',
    label: 'Fleet',
    when: () => nodes().length > 1,
    component: FleetHome,
  },
]
