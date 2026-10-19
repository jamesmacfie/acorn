/** @jsxImportSource @acorn/tui/jsx */
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
