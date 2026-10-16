import { KIT_NODE_COMPONENTS } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'A device and two Nodes',
  caption:
    'Your device keeps how acorn looks and which Nodes it may reach. Each Node keeps its own data, and the two share nothing.',
  terminal: { columns: 60, rows: 4 },
  width: 680,
}

// Graph has no named SDK export, so this reaches it by name, as clients-and-node does, and places the
// two ranks by hand for the same reason.
const { Graph } = KIT_NODE_COMPONENTS

export default function DeviceAndNodes() {
  return (
    <Graph
      id="device-and-nodes"
      ariaLabel="A device and two Nodes"
      nodes={[
        { id: 'device', label: 'Your device', detail: 'Appearance, shortcuts, paired Nodes' },
        { id: 'local', label: 'This computer', detail: 'Its projects, worktrees, and agents', tone: 'accent' as const },
        {
          id: 'remote',
          label: 'Build box',
          detail: 'Its own projects, worktrees, and agents',
          tone: 'accent' as const,
        },
      ]}
      edges={[
        { from: 'device', to: 'local' },
        { from: 'device', to: 'remote' },
      ]}
      positions={{ device: { x: 210, y: 0 }, local: { x: 105, y: 130 }, remote: { x: 315, y: 130 } }}
    />
  )
}
