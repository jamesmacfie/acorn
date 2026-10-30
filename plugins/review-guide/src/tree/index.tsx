import { mountTree, type AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { GuidePane } from './GuidePane'

const guide = (layout: 'wide' | 'narrow') =>
  solidTree((props: { taskId?: string; bridge: AcornBridge }) => <GuidePane {...props} layout={layout} />)

// One entry per surface, named by the manifest. `pane` fills the Guide pane, and `panel` the column
// beside each code host's change request diff. The host draws the tree with its own kit.
mountTree({ pane: guide('wide'), panel: guide('narrow') })
