import { KIT_NODE_COMPONENTS } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Graph',
  caption: 'Two steps, and a third that waits on both.',
  terminal: { columns: 40, rows: 4 },
  width: 480,
}

// The published SDK has no named `Graph` export yet, so this reaches it by name, the way a plugin
// would today. Two ranks, because Graph fits its view to a measured canvas and jsdom measures nothing,
// so a taller graph overflows the canvas's minimum height.
const { Graph } = KIT_NODE_COMPONENTS

export default function GraphSpecimen() {
  return (
    <Graph
      id="steps"
      ariaLabel="Steps"
      nodes={[
        { id: 'build', label: 'build' },
        { id: 'test', label: 'test' },
        { id: 'ship', label: 'ship' },
      ]}
      edges={[
        { from: 'build', to: 'ship' },
        { from: 'test', to: 'ship' },
      ]}
    />
  )
}
