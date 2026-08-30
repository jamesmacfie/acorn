import { lazy } from 'solid-js'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'
import { CREATE_TASK_ROUTE, PROJECT_ROUTE } from '@acorn/client-core/registries/corePaths.ts'

const Home = lazy(() => import('@acorn/client-core/workspaces/Home.tsx'))
const FleetHome = lazy(() => import('@acorn/client-core/node/FleetHome.tsx'))

export const coreSourceContributions: SourceContribution[] = [
  {
    id: 'home',
    order: 0,
    glyph: 'house',
    label: 'Home',
    isDefault: true,
    component: Home,
    routes: [
      { id: 'core.project', path: PROJECT_ROUTE, order: 10 },
      { id: 'core.create-task', path: CREATE_TASK_ROUTE, order: 20 },
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
