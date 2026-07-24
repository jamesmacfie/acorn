// The Docker rail Source: a local source (no integration row — no providerId), always visible.
// Containers aren't promotable to tasks; the linkage runs the other way (phase 2 matches running
// containers back to task worktrees), so promotion is a permanent stub.
import type { SourceContribution } from '../../../core/client/registries/sources'
import DockerBrowse from './DockerBrowse'

export const dockerSourceContribution: SourceContribution<never> = {
  id: 'docker',
  glyph: '◧',
  label: 'Docker',
  component: DockerBrowse,
  promotion: {
    canPromote: () => false,
    prepare: () => Promise.reject(new Error('docker items are not promotable')),
    create: () => Promise.reject(new Error('docker items are not promotable')),
  },
}
