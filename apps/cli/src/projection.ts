import type { AgentEventRecord, AgentSession, AgentTurn } from '@acorn/plugin-agents/contract/wire.ts'
import type { ArchivedTask, NodePluginState, NodeReach, Project, Task, Workspace } from '@acorn/protocol/api.ts'
import type { PairedDevice } from '@acorn/protocol/node.ts'

const apiVersion = 'acorn.cli/v1' as const

export const nodeResource = (
  nodeId: string,
  info: { protocolVersion: number; baseline: string; endpoint?: string },
) => ({
  apiVersion,
  kind: 'Node' as const,
  nodeId,
  id: nodeId,
  protocolVersion: info.protocolVersion,
  baseline: info.baseline,
  endpoint: info.endpoint ?? null,
})

// What a person on another machine needs to pair with this Node. The code is meant to be read, so it's
// printed. No device token is.
export const pairingWindowResource = (
  nodeId: string,
  window: { endpoints: string[]; identity: string; code: string; expiresAt: number },
) => ({
  apiVersion,
  kind: 'PairingWindow' as const,
  nodeId,
  endpoints: window.endpoints,
  identity: window.identity,
  code: window.code,
  expiresAt: new Date(window.expiresAt).toISOString(),
})

// What another machine connects to.
export const reachEndpoints = (reach: Pick<NodeReach, 'hosts' | 'port'>): string[] =>
  reach.hosts.map((host) => `https://${host}:${reach.port}`)

// The addresses this Node answers on besides loopback, and whether `node reach` restarted the Node to
// apply a change.
export const nodeReachResource = (nodeId: string, reach: NodeReach, restarted: boolean) => ({
  apiVersion,
  kind: 'NodeReach' as const,
  nodeId,
  hosts: reach.hosts,
  source: reach.source,
  port: reach.port,
  endpoints: reachEndpoints(reach),
  candidates: reach.candidates,
  restartRequired: reach.restartRequired,
  restarted,
})

const isoOrNull = (at: number | null) => (at === null ? null : new Date(at).toISOString())

export const deviceResource = (nodeId: string, row: PairedDevice, ownDeviceId: string | undefined) => ({
  apiVersion,
  kind: 'Device' as const,
  nodeId,
  id: row.id,
  name: row.name,
  pairedAt: new Date(row.createdAt).toISOString(),
  lastSeenAt: isoOrNull(row.lastSeenAt),
  revokedAt: isoOrNull(row.revokedAt),
  thisTerminal: row.id === ownDeviceId,
})

export const workspaceResource = (nodeId: string, row: Workspace) => ({
  apiVersion,
  kind: 'Workspace' as const,
  nodeId,
  id: row.id,
  name: row.name,
  isDefault: row.isDefault,
  sort: row.sort,
  projects: row.projects.map((project) => ({ id: project.id, name: project.name, sort: project.sort })),
})

export const projectResource = (nodeId: string, row: Project) => ({
  apiVersion,
  kind: 'Project' as const,
  nodeId,
  id: row.id,
  name: row.name,
  workspaceId: row.workspaceId,
  path: row.path,
  hidden: row.hidden,
  vcs: row.vcs,
  defaultBranch: row.defaultBranch,
  remoteUrl: row.remoteUrl,
})

export const taskResource = (nodeId: string, row: Task | ArchivedTask) => ({
  apiVersion,
  kind: 'Task' as const,
  nodeId,
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  origin: row.origin,
  status: row.status,
  branch: row.branch,
  worktreePath: row.worktreePath,
  parentId: row.parentId,
  ...('archivedAt' in row ? { archivedAt: row.archivedAt } : {}),
})

export const pluginResources = (nodeId: string, state: NodePluginState) =>
  state.plugins.map((row) => ({
    apiVersion,
    kind: 'Plugin' as const,
    nodeId,
    id: row.name,
    state: row.state,
    running: row.running,
    disabled: row.disabled,
    required: row.required,
    activeVersion: row.active?.version ?? null,
    installedVersion: row.installed?.version ?? null,
  }))

export const agentSessionResource = (nodeId: string, row: AgentSession, extra: Record<string, unknown> = {}) => ({
  apiVersion,
  kind: 'AgentSession' as const,
  nodeId,
  id: row.id,
  taskId: row.taskId,
  providerId: row.providerId,
  profileId: row.profileId,
  sessionKind: row.kind,
  title: row.title,
  runtimeState: row.runtimeState,
  attention: row.attention,
  lastEventSeq: row.lastEventSeq,
  queuedTurns: row.queuedTurns,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...extra,
})

export const agentTurnAck = (nodeId: string, row: AgentTurn) => ({
  apiVersion,
  kind: 'AgentTurnAck' as const,
  nodeId,
  id: row.id,
  sessionId: row.sessionId,
  status: row.status,
  ordinal: row.ordinal,
})

export const agentEventResource = (nodeId: string, row: AgentEventRecord) => ({
  apiVersion,
  kind: 'AgentEvent' as const,
  nodeId,
  id: row.id,
  sessionId: row.sessionId,
  turnId: row.turnId,
  seq: row.seq,
  event: row.event,
  createdAt: row.createdAt,
  ...(row.foldedThroughSeq !== undefined ? { foldedThroughSeq: row.foldedThroughSeq } : {}),
})
