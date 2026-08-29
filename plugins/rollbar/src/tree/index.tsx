import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { RollbarPane } from './app'

// The tree path (docs/plugin-authoring.md § The client half). This bundle runs in a worker with no
// DOM: what it emits is a tree of acorn's own component names, and the shell mounts its own
// components for them. So there is no stylesheet here, no root element, and no Solid-in-a-document —
// the pane's focus behaviour, keyboard handling, ARIA and style pack are the host's, which is the
// whole reason for the move.
//
// One entry per surface this plugin draws, named by its manifest's `regions`.
mountTree({ pane: solidTree(RollbarPane) })
