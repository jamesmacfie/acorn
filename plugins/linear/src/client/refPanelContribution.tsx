// linear's contribution to the ref-panel registry: what another plugin gets when it holds a reference to a
// Linear ticket and wants to show it (packages/client-core/src/registries/refPanels.ts).
//
// An ADAPTER rather than registering LinearIssuePanel directly, and it is three lines of prop mapping for a
// reason worth keeping: `LinearIssueTarget` is this plugin's own vocabulary and the panel has a second,
// unrelated caller (LinearPane, which renders `variant="pane"` inside the task layout). Registering the
// component itself would make the registry's generic props contract the panel's only shape and force that
// caller to speak it too.
import { lazy } from 'solid-js'
import type { RefPanelContribution, RefPanelTarget } from '@acorn/client-core/registries/refPanels.ts'

const LinearIssuePanel = lazy(() => import('./LinearIssuePanel'))

// `connectionId` stays OPTIONAL through the mapping. A host that scanned a ticket id out of PR text has no
// connection to name, and the panel already resolves an unscoped identifier server-side across every
// connected workspace — so defaulting one here would narrow a lookup that is deliberately broad.
const toTarget = (ref: RefPanelTarget) => ({ identifier: ref.displayId, connectionId: ref.connectionId })

export const linearRefPanelContribution: RefPanelContribution = {
  id: 'linear.issue-panel',
  providerId: 'linear',
  component: (props) => (
    <LinearIssuePanel
      target={toTarget(props.ref)}
      targets={props.refs?.map(toTarget)}
      onSelectTarget={props.onSelectRef && ((target) => props.onSelectRef!({ providerId: 'linear', displayId: target.identifier, connectionId: target.connectionId }))}
      onClose={props.onClose}
      onContentClick={props.onContentClick}
    />
  ),
}
