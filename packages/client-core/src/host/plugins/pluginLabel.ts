import type { NodePluginRow } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../../infra/node/activeNode'
import { distribution } from './distribution'

type Named = Pick<NodePluginRow, 'name' | 'label'>

const labelOf = (row: Named): string => row.label?.trim() || row.name

/**
 * The name a person reads for a plugin: "GitHub" for `github`, "API requests" for `http`.
 *
 * Pass the roster row when you have it. Given only an id, this looks in the plugins this device holds,
 * then the active node's roster, then any other node's. A node that predates `label`, or a plugin no
 * node lists any more, gives back the id. Reactive, so a label that arrives after first paint replaces
 * the id.
 *
 * Display only. A loaded plugin writes its own label, so a trust prompt, a review, or an audit record
 * names the id instead.
 */
export function pluginLabel(plugin: string | Named): string {
  if (typeof plugin !== 'string') return labelOf(plugin)
  const snapshot = distribution()
  const device = snapshot.devicePlugins.find((entry) => entry.row.name === plugin)
  if (device) return labelOf(device.row)
  const active = activeNodeId()
  const observations = [...snapshot.byNode.values()].sort((a, b) => Number(b.nodeId === active) - Number(a.nodeId === active))
  for (const observation of observations) {
    const row = observation.rows.find((candidate) => candidate.name === plugin)
    if (row?.label?.trim()) return labelOf(row)
  }
  return plugin
}
