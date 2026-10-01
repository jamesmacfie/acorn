import { createComponent, lazy } from 'solid-js'
import { useParams } from '@solidjs/router'
import type { RemoteContribution } from '../tree/treeRegistry'
import { suppliedRemoteTree } from '../tree/table'
import { sidebarCollapsed } from '../../kit/lib/layout/collapseState'

// Resolve the host's renderer when a source is drawn. The terminal supplies its cell renderer before
// plugin registration; the desktop uses the DOM renderer. Neither runs plugin code in the shell.
const RemoteTree = lazy(async () => ({ default: suppliedRemoteTree() ?? (await import('../tree/RemoteTree')).RemoteTree }))

export default function SourceRegion(props: { contribution: RemoteContribution; sourceId: string; region: 'list' | 'detail' }) {
  const params = useParams<{ projectId?: string }>()
  const scope = () => ({ ...(params.projectId ? { projectId: params.projectId } : {}) })
  // The worker cannot read the host's collapse signal, so the list is told in its props and draws its
  // rows' rail forms (`Row`'s `collapsedIcon`) from that. The key is the one `SourceSurface` collapses
  // the column under: the source's id.
  const collapsed = sidebarCollapsed(props.sourceId)
  return createComponent(RemoteTree, {
    contribution: props.contribution,
    props: () => ({
      sourceId: props.sourceId,
      region: props.region,
      ...(props.region === 'list' ? { collapsed: collapsed() } : {}),
      ...scope(),
    }),
    scope,
  })
}
