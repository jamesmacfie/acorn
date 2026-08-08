import { createMemo } from 'solid-js'
import { workspacesKey, workspacesRoute, type Workspace } from '@acorn/protocol/api.ts'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { readJson } from '../apiClient'
import { activeNodeId, setActiveNode } from '../node/activeNode'
import { createFleetQuery, type FleetUnavailable } from '../node/fanout'
import { nodes } from '../node/fleet'
import { sourcePath } from '../registries/sources'

export type FleetWorkspace = {
  workspace: Workspace
  nodeId: string
  node: NodeRecord
}

export type FleetWorkspaceList = {
  entries: FleetWorkspace[]
  unavailable: FleetUnavailable[]
  // False when there is one node, which is every single-node install. Consumers use it to decide whether
  // to render a node label at all — with one node it names the only machine there is, which docs/ui-design.md § New
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
// The order is the whole point. The source route has no node in it, and the shell derives the active
// workspace from that repo against the ACTIVE node's query cache — so navigating first would resolve the
// path against the wrong node, which either finds nothing or, worse, finds a different repo that happens
// to share the owner/name. docs/ui-design.md § New surfaces requires node context to switch atomically.
export function selectFleetWorkspace(entry: FleetWorkspace, navigate: (path: string) => void): void {
  const first = entry.workspace.projects[0]
  if (!first) return // an empty workspace has nowhere to go, same as the single-node picker
  if (entry.nodeId !== activeNodeId()) setActiveNode(entry.nodeId)
  navigate(sourcePath('project', { projectId: first.id }))
}
