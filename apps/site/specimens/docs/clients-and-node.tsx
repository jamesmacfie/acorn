import { KIT_NODE_COMPONENTS } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Clients and a Node',
  caption: 'The desktop app, the terminal client, and the command line all talk to one Node.',
  terminal: { columns: 60, rows: 4 },
  width: 680,
}

// Graph has no named SDK export, so this reaches it by name, as the kit's graph specimen does. Two
// ranks, placed by hand, because jsdom measures nothing and Graph can't fit a taller view to its canvas.
const { Graph } = KIT_NODE_COMPONENTS

const clients = ['Desktop app', 'Terminal client', 'Command line']

export default function ClientsAndNode() {
  return (
    <Graph
      id="clients-and-node"
      ariaLabel="Clients and a Node"
      nodes={[
        ...clients.map((label) => ({ id: label, label, detail: 'On your device' })),
        { id: 'node', label: 'Node', detail: 'Your data, worktrees, and agents', tone: 'accent' as const },
      ]}
      edges={clients.map((from) => ({ from, to: 'node' }))}
      positions={{
        ...Object.fromEntries(clients.map((label, lane) => [label, { x: lane * 210, y: 0 }])),
        node: { x: 210, y: 130 },
      }}
    />
  )
}
