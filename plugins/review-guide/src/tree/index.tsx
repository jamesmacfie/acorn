import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { GuidePane } from './GuidePane'

// One entry per surface, named by the manifest's `regions`. The host draws the tree with its own kit.
mountTree({ pane: solidTree(GuidePane) })
