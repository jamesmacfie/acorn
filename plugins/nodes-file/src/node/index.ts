import type { NodePlugin } from '@acorn/plugin-api/node'
import { nodesFileProvider } from '../server/provider'

// The reference node provider (docs/plugins.md § Node providers). One registration, and no routes, no
// tables, no client half.
//
// `ACORN_NODES_FILE` names the JSON file. Unset, the plugin registers nothing at all, so the whole
// node-provider section of Settings → Nodes stays hidden and this package costs an install nothing.

export const nodesFilePlugin = (): NodePlugin => ({
  name: 'nodes-file',
  init: (ctx) => {
    const path = process.env.ACORN_NODES_FILE?.trim()
    if (!path) return
    ctx.providers.nodes(nodesFileProvider(path))
  },
})
