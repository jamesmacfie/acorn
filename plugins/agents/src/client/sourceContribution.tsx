import { lazy } from 'solid-js'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'

const AgentCenter = lazy(() => import('./AgentCenter'))

export const agentCenterSourceContribution: SourceContribution<never> = {
  id: 'agents',
  // Rail position, declared (registries/sources.ts § order). Was implied by this plugin's place in
  // apps/desktop/src/app/client/plugins.ts.
  order: 60,
  glyph: 'bot',
  label: 'Agents',
  component: AgentCenter,
  defaultPane: 'agents',
  promotion: {
    canPromote: () => false,
    prepare: () => Promise.reject(new Error('Agent sessions are already task-scoped.')),
    create: () => Promise.reject(new Error('Agent sessions are already task-scoped.')),
  },
}
