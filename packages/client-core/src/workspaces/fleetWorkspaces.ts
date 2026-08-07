import { createMemo } from 'solid-js'
import { workspacesKey, workspacesRoute, type Workspace } from '@acorn/protocol/api.ts'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { readJson } from '../apiClient'
import { activeNodeId, setActiveNode } from '../node/activeNode'
import { createFleetQuery, type FleetUnavailable } from '../node/fanout'
import { nodes } from '../node/fleet'

// Workspaces across the whole fleet, for the topbar picker and the ⌘L palette (plan.md § Phase 4:
// "Workspace picker grouped by node").
//
// A workspace belongs to exactly one node (README § Vocabulary), so this is a grouped list rather than a
// merged one — and the grouping is what makes the picker usable at all: two nodes will have a "Default"
// workspace, and without the node beside it the owner cannot tell which is which.
export type FleetWorkspace = {
  workspace: Workspace
  nodeId: string
  node: NodeRecord
}

export type FleetWorkspaceList = {
  entries: FleetWorkspace[]
  unavailable: FleetUnavailable[]
  // False when there is one node, which is every single-node install. Consumers use it to decide whether
  // to render a node label at all — with one node it names the only machine there is, which ui.md § New
  // surfaces rules out ("first-run never mentions nodes").
  grouped: boolean
}

export function createFleetWorkspaces(): () => FleetWorkspaceList {
  const [result] = createFleetQuery(
    () => workspacesKey,
    (nodeId, _dep, signal) => readJson<Workspace[]>(workspacesRoute, { nodeId, signal }),
  )
  return createMemo<FleetWorkspaceList>(() => {
    const current = result()
    return {
      // Node order (main's list) then the node's own workspace order, so the picker does not reshuffle
      // because one node answered faster.
      entries: current.rows.flatMap((row) =>
        row.data.map((workspace) => ({ workspace, nodeId: row.nodeId, node: row.node })),
      ),
      unavailable: current.unavailable,
      grouped: nodes().length > 1,
    }
  })
}

// Selecting a workspace on another node: switch the node FIRST, then navigate.
//
// The order is the whole point. Every route is `/:owner/:repo` with no node in it, and the shell derives
// the active workspace from that repo against the ACTIVE node's query cache — so navigating first would
// resolve the path against the old node, which either finds nothing or, worse, finds a different repo that
// happens to share the owner/name. ui.md § New surfaces asks for exactly this: "Selecting a workspace
// switches node context atomically".
export function selectFleetWorkspace(entry: FleetWorkspace, navigate: (path: string) => void): void {
  const first = entry.workspace.repos[0]
  if (!first) return // an empty workspace has nowhere to go, same as the single-node picker
  if (entry.nodeId !== activeNodeId()) setActiveNode(entry.nodeId)
  navigate(`/${first.owner}/${first.name}`)
}
