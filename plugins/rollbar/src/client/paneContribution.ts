// The Rollbar task pane: the items linked to this task.
//
// Moved out of apps/desktop/src/app/client/taskPaneContributions.tsx. Unlike linear's, this one needed
// no wrapper component — RollbarPane already takes `{ task }`, which is the pane contract.
import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/plugin-api/client'

const RollbarPane = lazy(() => import('./RollbarPane'))

export const rollbarPaneContribution: PaneContribution = {
  id: 'rollbar', providerId: 'rollbar', label: 'Rollbar', glyph: '◍', description: 'Linked Rollbar items', order: 100,
  defaultChord: 'meta+shift+o',
  when: (task) => task.links.some((link) => link.providerId === 'rollbar'),
  component: RollbarPane,
}
