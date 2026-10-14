import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// The PR pane's registration, apart from the pane it registers, which is what makes the pane lazy.
//
// A contribution is a registry row, and a registry row that holds a component holds the component's
// whole import graph in whichever chunk holds the row. This plugin's client half is registered on
// every cold window, so an eager row would put the pull-request model, the overview, the
// conversation, the file list, the check log and the diff viewer in the renderer's first paint, for
// a pane that only exists on a task with a pull request.
//
// `single`, not the host's `list-detail`: the halves are one surface with a shared model rather than
// two regions, and `Sections` inside the pane is the node that arranges them.
const PrPane = lazy(async () => ({ default: (await import('./PrPane')).PrPane }))

export const prPaneContribution: PaneLayoutContribution = {
  id: 'pr',
  label: 'Pull request',
  glyph: 'git-pull-request',
  description: 'Details, files, and diff',
  order: 10,
  defaultChord: 'meta+shift+r',
  when: (task) => task.pullNumber != null,
  url: (task) =>
    task.github && task.pullNumber != null
      ? `https://github.com/${task.github.owner}/${task.github.name}/pull/${task.pullNumber}`
      : undefined,
  minWidth: 520,
  layout: 'single',
  regions: { body: PrPane },
}
