import { createComponent, lazy } from 'solid-js'
import { useParams } from '@solidjs/router'
import type { RemoteContribution } from '../tree/treeRegistry'
import { suppliedRemoteTree } from '../tree/table'

// Resolve the host's renderer when a source is drawn. The terminal supplies its cell renderer before
// plugin registration; the desktop uses the DOM renderer. Neither runs plugin code in the shell.
const RemoteTree = lazy(async () => ({ default: suppliedRemoteTree() ?? (await import('../tree/RemoteTree')).RemoteTree }))

export default function SourceRegion(props: { contribution: RemoteContribution; sourceId: string; region: 'list' | 'detail' }) {
  const params = useParams<{ projectId?: string }>()
  const scope = () => ({ ...(params.projectId ? { projectId: params.projectId } : {}) })
  return createComponent(RemoteTree, {
    contribution: props.contribution,
    props: () => ({ sourceId: props.sourceId, region: props.region, ...scope() }),
    scope,
  })
}
