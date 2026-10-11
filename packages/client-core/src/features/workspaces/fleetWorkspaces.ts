import { createMemo } from 'solid-js'
import {
  prefsKey,
  prefsRoute,
  projectsKey,
  projectsRoute,
  workspacesKey,
  workspacesRoute,
  type Project,
  type ProjectsResponse,
  type Workspace,
} from '@acorn/protocol/api.ts'
import { WORKSPACES_PREF_KEY, workspacesMode } from '@acorn/protocol/workspacesMode.ts'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { createFleetQuery, type FleetUnavailable } from '../../infra/node/fanout'
import { nodes } from '../../infra/node/fleet'
import { projectPath } from '../../host/registries/commands/corePaths'

export type FleetWorkspace = {
  workspace: Workspace
  nodeId: string
  node: NodeRecord
}

export type FleetWorkspaceList = {
  entries: FleetWorkspace[]
  unavailable: FleetUnavailable[]
  // False when there is one node, which is every single-node install. Consumers use it to decide
  // whether to render a node label at all: with one node it names the only machine there is, and
  // a first run never mentions nodes at all.
  grouped: boolean
}

/** Hide dead picker rows; off mode also excludes projects hidden on that specific Node. */
export function pickerWorkspaces(
  workspaces: readonly Workspace[],
  projects: readonly Project[],
  preference: string | undefined,
): Workspace[] {
  if (workspacesMode(preference, projects.length) === 'on')
    return workspaces.filter((workspace) => workspace.projects.length > 0)
  const visible = new Set(projects.filter((project) => !project.hidden).map((project) => project.id))
  return workspaces.flatMap((workspace) => {
    const members = workspace.projects.filter((project) => visible.has(project.id))
    return members.length ? [{ ...workspace, projects: members }] : []
  })
}

export function createFleetWorkspaces(): () => FleetWorkspaceList {
  const [result] = createFleetQuery(
    () => workspacesKey,
    (nodeId, _dep, signal) => readJson<Workspace[]>(workspacesRoute, { nodeId, signal }),
  )
  const [prefs] = createFleetQuery(
    () => prefsKey,
    (nodeId, _dep, signal) => readJson<Record<string, string>>(prefsRoute, { nodeId, signal }),
  )
  const [projects] = createFleetQuery(
    () => projectsKey,
    // Shares the active Node's projects query key, so the cache value must be the same array shape.
    async (nodeId, _dep, signal) => (await readJson<ProjectsResponse>(projectsRoute, { nodeId, signal })).projects,
  )
  return createMemo<FleetWorkspaceList>(() => {
    const current = result()
    const preferenceResult = prefs()
    const projectResult = projects()
    const preferences = new Map(preferenceResult.rows.map((row) => [row.nodeId, row.data]))
    const projectRows = new Map(projectResult.rows.map((row) => [row.nodeId, row.data]))
    const unavailable = new Map<string, FleetUnavailable>()
    for (const node of [...current.unavailable, ...preferenceResult.unavailable, ...projectResult.unavailable]) {
      if (!unavailable.has(node.nodeId)) unavailable.set(node.nodeId, node)
    }
    return {
      // Node order (main's list) then the node's own workspace order, so the picker does not reshuffle
      // because one node answered faster. A workspace with no projects is left out: it has nowhere to
      // navigate to (see selectFleetWorkspace below), so it would only ever be a dead row.
      entries: current.rows.flatMap((row) => {
        const allProjects = projectRows.get(row.nodeId)
        const nodePrefs = preferences.get(row.nodeId)
        if (!allProjects || !nodePrefs) return []
        return pickerWorkspaces(row.data, allProjects, nodePrefs[WORKSPACES_PREF_KEY]).map((workspace) => ({
          workspace,
          nodeId: row.nodeId,
          node: row.node,
        }))
      }),
      unavailable: [...unavailable.values()],
      grouped: nodes().length > 1,
    }
  })
}

// Selecting a workspace on another node: switch the node first, then navigate.
//
// The order is the whole point. The source route has no node in it, and the shell derives the
// active workspace from that repo against the active node's query cache, so navigating first
// would resolve the path against the wrong node, which either finds nothing or, worse, finds a
// different repo that happens to share the owner/name.
export function selectFleetWorkspace(
  entry: Pick<FleetWorkspace, 'workspace' | 'nodeId'>,
  navigate: (path: string) => void,
): void {
  const first = entry.workspace.projects[0]
  if (!first) return // an empty workspace has nowhere to go, same as the single-node picker
  if (entry.nodeId !== activeNodeId()) setActiveNode(entry.nodeId)
  navigate(projectPath(first.id))
}
