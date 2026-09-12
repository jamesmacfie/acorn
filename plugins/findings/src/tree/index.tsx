import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { FindingsPane } from './FindingsPane'
import { FindingsSettings } from './FindingsSettings'

mountTree({ pane: solidTree(FindingsPane), settings: solidTree(FindingsSettings) })
