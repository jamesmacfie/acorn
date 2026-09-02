import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// The PR pane's registration, apart from the pane it registers, which is what makes the pane lazy.
//
// A contribution is a registry row, and a registry row that holds a component holds the component's
// whole import graph in whichever chunk holds the row (docs/future/performance/decisions.md §
// Registries hold loaders). This plugin's client half is registered on every cold window, so the row
// used to put the pull-request model, the overview, the conversation, the file list, the check log
// and the diff viewer in the renderer's first paint — for a pane that only exists on a task with a
// pull request. Every sibling plugin's pane already reads this way
// (../../../../editor/src/client/paneContribution.ts and the rest).
//
// `single`, not the host's `list-detail`: the halves are one surface with a shared model rather than
// two regions, and `Sections` inside the pane is the node that arranges them (./PrPane.tsx).
const PrPane = lazy(async () => ({ default: (await import('./PrPane')).PrPane }))

export const prPaneContribution: PaneLayoutContribution = {
  id: 'pr',
  label: 'PR review',
  glyph: 'git-pull-request',
  description: 'Overview, files & diff',
  order: 10,
  defaultChord: 'meta+shift+r',
  when: (task) => task.pullNumber != null,
  minWidth: 520,
  layout: 'single',
  regions: { body: PrPane },
}
