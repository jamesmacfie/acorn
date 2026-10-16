import { KIT_NODE_COMPONENTS } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Who reaches a Node',
  caption: 'Your devices, your agents, and your plugins each reach the Node with a different grant.',
  terminal: { columns: 60, rows: 4 },
  width: 680,
}

// Laid out as clients-and-node is, for the same reason: two ranks placed by hand, because jsdom
// measures nothing and Graph can't fit a taller view to its canvas.
const { Graph } = KIT_NODE_COMPONENTS

const callers = [
  { id: 'devices', label: 'Your devices', detail: 'Paired, with full owner access' },
  { id: 'agents', label: 'Agents', detail: 'A token for one task' },
  { id: 'plugins', label: 'Plugins', detail: 'The permissions you accepted' },
]

export default function TrustModel() {
  return (
    <Graph
      id="trust-model"
      ariaLabel="Who reaches a Node"
      nodes={[...callers, { id: 'node', label: 'Node', detail: 'Your data and keys', tone: 'accent' as const }]}
      edges={callers.map(({ id }) => ({ from: id, to: 'node' }))}
      positions={{
        ...Object.fromEntries(callers.map(({ id }, lane) => [id, { x: lane * 210, y: 0 }])),
        node: { x: 210, y: 130 },
      }}
    />
  )
}
