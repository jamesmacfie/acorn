import { Registry } from './registry'

// A number a plugin can put on a Fleet home node card (docs/frontend.md § Registries and plugins).
//
// Core supplies the task count, since `tasks` is core's table. Everything else on the card belongs to
// a plugin: "agents running" is the agents plugin's, "workflow runs" is workflows'. Fleet home lives
// in client-core and can't import either, and a card that hardcoded two plugin numbers would break
// the moment one was disabled on that node.
//
// Not merged with the attention registry, even though both fetch per node. An attention item is a
// navigable row with a severity and a target; a stat is one integer with a label.
export type NodeStatContribution = {
  id: string
  // Card order, declared, same rule as every other registry here.
  order: number
  // Singular and plural, so the card reads "1 agent running" rather than "1 agents running".
  label: [one: string, many: string]
  // Resolved against one node, addressed explicitly. A stat fetcher must never read the ambient active
  // node: the point is that Fleet home shows every node at once.
  fetch(nodeId: string, signal: AbortSignal): Promise<number>
}

export const nodeStatRegistry = new Registry<NodeStatContribution>('node-stat')

export const nodeStatContributions = (): NodeStatContribution[] =>
  [...nodeStatRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// `0` reads as "nothing to report" and is hidden. A stat whose fetch fails is also hidden rather than
// shown as 0, because "no agents running" and "couldn't ask" are different facts, and the card already
// carries a connection badge that says which one it is.
export const formatNodeStat = (stat: NodeStatContribution, count: number): string =>
  `${count} ${count === 1 ? stat.label[0] : stat.label[1]}`
