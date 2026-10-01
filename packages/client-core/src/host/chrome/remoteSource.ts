import { createComponent, lazy } from 'solid-js'
import type { PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import { qualifiedContributionId } from '../plugins/contributionIds'
import type { RemoteContribution } from '../tree/treeRegistry'
import type { SourcePanel } from './sourcePanel'

// The router and host renderer load when this source is first drawn, so bare-Node registry passes
// never evaluate a DOM router while discovering its manifest.
const SourceRegion = lazy(() => import('./remoteSourceRegion'))

/** A client-only source has two remote-tree regions in the same host-owned source layout. */
export function remoteSourcePanel(pluginId: string, hash: string, descriptor: PluginSourceDescriptor): SourcePanel {
  const tree = descriptor.tree!
  const base = qualifiedContributionId(pluginId, descriptor.id)
  const list: RemoteContribution = { id: `${base}.list`, pluginId, hash, entry: tree.list }
  const detail: RemoteContribution = { id: `${base}.detail`, pluginId, hash, entry: tree.detail }
  return {
    regions: {
      list: () => createComponent(SourceRegion, { contribution: list, sourceId: descriptor.id, region: 'list' }),
      detail: () => createComponent(SourceRegion, { contribution: detail, sourceId: descriptor.id, region: 'detail' }),
      // A tree is a run of kit nodes, so it gets the padding and scroller a pane body gets. A tree that
      // draws its own split loses the padding again through the column's `:has(.ui-listdetail)` rule.
      scroll: true,
    },
  }
}
