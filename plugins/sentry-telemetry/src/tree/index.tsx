import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import SentrySettingsPage from './settings'

// The tree path (docs/plugin-authoring.md § The client half). This bundle runs in a worker with no
// DOM: what it emits is a tree of acorn's own component names, and the shell mounts its own
// components for them. So there is no stylesheet here and no root element.
//
// One entry, because this plugin draws one region: its settings page. Everything else it does
// happens on the node, where the records are.
mountTree({
  settings: solidTree(SentrySettingsPage),
})
