import { mountTree } from 'acorn-plugin-sdk'
import { solidTree } from 'acorn-plugin-sdk/remote'
import { SessionCostBadge } from './SessionCostBadge'

mountTree({ sessionCost: solidTree(SessionCostBadge) })
