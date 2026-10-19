import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import PublishedDashboardPanel from './PublishedDashboardPanel'

/** A plan that isn't on any dashboard, drawn with the dashboard's own panel and run under this device:
 *  an agent-built app's `Panel`. No header actions, because there is nothing published to edit. */
export default function PlanPanel(props: {
  id: string
  plan: PanelPlan
  workspaceId: string
  inputs?: Record<string, unknown>
  active?: boolean
}) {
  return (
    <PublishedDashboardPanel
      definition={{ id: props.id, title: props.plan.title, shaping: {}, view: props.plan.view }}
      workspaceId={props.workspaceId}
      plan={props.plan}
      inputs={props.inputs}
      active={props.active}
    />
  )
}
