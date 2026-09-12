import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { DatabasePaneApp } from './app'

// The tree path (docs/plugin-authoring.md § The client half). This bundle runs in a worker with no
// DOM: what it emits is a tree of acorn's own component names, and the shell mounts its own
// components for them. So there is no stylesheet here and no root element.
//
// The pane is still `document-over-frame`: the SQL editor above is the host's, and this tree
// fills the region below it. What changed is that the region is no longer an iframe, so the two halves
// of the pane are now the same kind of thing.
mountTree({ panel: solidTree(DatabasePaneApp) })
