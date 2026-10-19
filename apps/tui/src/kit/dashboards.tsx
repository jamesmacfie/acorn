/** @jsxImportSource @acorn/tui/jsx */
import { onMount, type JSX } from 'solid-js'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { readPanelShowCall } from '@acorn/client-core/features/dashboards/panelShowCall.ts'
import { Text } from './showing'

// The terminal's `@acorn/plugin-api/ui/dashboards`. This host draws no dashboard views
// (plugins/SourcePanel.tsx), so an agent's panel card is one line: what the panel shows, and where it draws.
export function PanelToolCard(props: AgentToolCardProps) {
  const call = () => readPanelShowCall(props.tool)
  const line = () => {
    const title = call().input?.title ?? 'Panel'
    const description = call().result?.description.join(' ')
    if (description) return `${title}: ${description} The panel draws in the desktop app.`
    // A harness reports a refused call as completed, with the error as its output.
    return props.tool.status === 'pending' || props.tool.status === 'running'
      ? `${title}: checking the plan…`
      : `${title}: the plan didn't pass its checks, so nothing was drawn.`
  }
  return <Text emphasis="muted">{line()}</Text>
}

/** How many rows a transcript card takes before it cuts off, the terminal's version of 480 pixels. */
const CARD_ROWS = 24

/** A card's body, capped in rows. A terminal transcript draws only what is on screen, so the card counts
 *  as visible once it mounts. */
export function CardFrame(props: { onVisible?: (visible: boolean) => void; children: JSX.Element }) {
  onMount(() => props.onVisible?.(true))
  return (
    <box flexDirection="column" flexShrink={0} maxHeight={CARD_ROWS} overflow="hidden">
      {props.children}
    </box>
  )
}

/** A plan as a panel: one line here, since this host draws no dashboard views. */
export function PlanPanel(props: {
  id: string
  plan: PanelPlan
  workspaceId: string
  inputs?: Record<string, unknown>
  active?: boolean
}) {
  return <Text emphasis="muted">{`${props.plan.title}: this panel draws in the desktop app.`}</Text>
}

export type DashboardTab = { id: string; name: string; workspaceId?: string }

/** No Home tabs to add to: this host draws no dashboards and doesn't load their preference. */
export const homeTabsToAddTo = (_workspaceId: string): DashboardTab[] => []

/** Nothing offers a tab here, so nothing is placed. */
export function placeOnHomeTab(_definition: unknown, _workspaceId: string, _tab: DashboardTab): void {}
