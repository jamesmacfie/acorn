import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { HttpDetailApp, HttpListApp, HttpSettingsApp } from './app'

// The tree path (docs/plugin-authoring.md § The client half). This bundle runs in a worker with no
// DOM: what it emits is a tree of acorn's own component names, and the shell mounts its own
// components for them. So there is no stylesheet here and no root element.
//
// One entry per region, not per surface. The two panes are `list-detail`, so the host mounts `list`
// and `detail` separately and they differ only in whether it gave them a task; the settings page picks
// a project first and is one region of its own.
//
// Both pane entries run in this one worker, which is what lets them share ./panelModel.ts. That is the
// loaded-plugin half of the region seam: a compiled pane gets its shared model from the host, and a
// loaded one already has module scope (docs/panes.md § Layout model).
mountTree({
  list: solidTree(HttpListApp),
  detail: solidTree(HttpDetailApp),
  settings: solidTree(HttpSettingsApp),
})
