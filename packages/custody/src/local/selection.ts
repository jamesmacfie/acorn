import type { FleetNode, FleetStore } from '../broker/fleetStore'

export class AmbiguousNodeError extends Error {
  constructor(readonly target: string, readonly ids: string[]) {
    super(`Node ${target} matches multiple IDs: ${ids.join(', ')}.`)
  }
}

export function rememberedNode(fleet: FleetStore, target: string): FleetNode | undefined {
  const matches = fleet.list().filter((node) => node.nodeId === target || node.label === target || node.endpoint === target)
  if (matches.length > 1) throw new AmbiguousNodeError(target, matches.map((node) => node.nodeId))
  return matches[0]
}
