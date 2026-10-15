import { KIT_NODE_COMPONENTS } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'A workflow run',
  caption:
    'A run of three steps. The agent step is done, so the two steps after it run at once: a command, and a gate that waits for you.',
  terminal: { columns: 60, rows: 4 },
  width: 680,
}

// Graph has no named SDK export, so this reaches it by name, as clients-and-node does, and places the
// two ranks by hand for the same reason.
const { Graph } = KIT_NODE_COMPONENTS

export default function WorkflowRun() {
  return (
    <Graph
      id="workflow-run"
      ariaLabel="A workflow run"
      nodes={[
        { id: 'fix', label: 'Fix the bug', detail: 'Agent · Done', glyph: 'bot', tone: 'ok' as const },
        {
          id: 'tests',
          label: 'Run the tests',
          detail: 'Command · Running',
          glyph: 'terminal',
          tone: 'accent' as const,
        },
        {
          id: 'review',
          label: 'Review the fix',
          detail: 'Wait for a person · Waiting',
          glyph: 'user',
          tone: 'warn' as const,
        },
      ]}
      edges={[
        { from: 'fix', to: 'tests' },
        { from: 'fix', to: 'review' },
      ]}
      positions={{ fix: { x: 210, y: 0 }, tests: { x: 105, y: 130 }, review: { x: 315, y: 130 } }}
    />
  )
}
