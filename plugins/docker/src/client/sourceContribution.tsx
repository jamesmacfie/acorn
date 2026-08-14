import { lazy } from 'solid-js'
import type { SourceContribution } from '@acorn/plugin-api/client'

const DockerBrowse = lazy(() => import('./DockerBrowse'))

export const dockerSourceContribution: SourceContribution<never> = {
  id: 'docker',
  // Rail position, declared (registries/sources.ts § order). Was implied by this plugin's place in
  // apps/desktop/src/app/client/plugins.ts.
  order: 40,
  glyph: 'brand:docker',
  label: 'Docker',
  component: DockerBrowse,
  promotion: {
    canPromote: () => false,
    prepare: () => Promise.reject(new Error('docker items are not promotable')),
    create: () => Promise.reject(new Error('docker items are not promotable')),
  },
}
