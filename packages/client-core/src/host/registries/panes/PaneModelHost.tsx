import { onCleanup, type ParentProps } from 'solid-js'
import { acquirePaneModelHost, PaneModelScopeContext } from './paneModels'

/** The selected Node shell owns models; individual pane and region mounts borrow them. */
export function PaneModelHost(props: ParentProps<{ nodeId: string | null }>) {
  const lease = acquirePaneModelHost(props.nodeId)
  onCleanup(lease.release)
  return <PaneModelScopeContext.Provider value={lease.scope}>{props.children}</PaneModelScopeContext.Provider>
}
