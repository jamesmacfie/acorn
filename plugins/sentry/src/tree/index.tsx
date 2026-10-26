import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { SentryPane } from './app'

// The tree path (docs/plugin-authoring/the-client-half.md § The client half): this bundle runs in a
// worker with no DOM and emits a tree of acorn's own component names, which the shell mounts.
mountTree({ pane: solidTree(SentryPane) })
