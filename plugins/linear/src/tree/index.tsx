import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { LinearIssuePane } from './app'

// The tree path (docs/plugin-authoring.md § The client half). This bundle runs in a worker with no
// DOM: what it emits is a tree of acorn's own component names, and the shell mounts its own
// components for them. So there is no stylesheet here and no root element.
//
// One renderer, three surfaces — the task pane, the project-scoped list detail, and the reference
// panel — because they draw the same ticket and differ only in what the host mounts them with.
mountTree({ pane: solidTree(LinearIssuePane) })
