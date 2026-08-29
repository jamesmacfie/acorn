import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { HttpPaneApp, HttpSettingsApp } from './app'

// The tree path (docs/plugin-authoring.md § The client half). This bundle runs in a worker with no
// DOM: what it emits is a tree of acorn's own component names, and the shell mounts its own
// components for them. So there is no stylesheet here and no root element.
//
// Two renderers, three surfaces: the two panes draw the same panel and differ only in whether the
// host mounted them with a task, and the settings page picks a project first.
mountTree({
  pane: solidTree(HttpPaneApp),
  settings: solidTree(HttpSettingsApp),
})
