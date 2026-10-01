import type { ArchivedTask, NodePluginState, Project, Task, Workspace } from '@acorn/protocol/api.ts'

const apiVersion = 'acorn.cli/v1' as const

export const nodeResource = (nodeId: string, info: { protocolVersion: number; baseline: string; endpoint?: string }) => ({
  apiVersion, kind: 'Node' as const, nodeId, id: nodeId, protocolVersion: info.protocolVersion,
  baseline: info.baseline, endpoint: info.endpoint ?? null,
})

export const workspaceResource = (nodeId: string, row: Workspace) => ({
  apiVersion, kind: 'Workspace' as const, nodeId, id: row.id, name: row.name,
  isDefault: row.isDefault, sort: row.sort,
  projects: row.projects.map((project) => ({ id: project.id, name: project.name, sort: project.sort })),
})

export const projectResource = (nodeId: string, row: Project) => ({
  apiVersion, kind: 'Project' as const, nodeId, id: row.id, name: row.name,
  workspaceId: row.workspaceId, path: row.path, hidden: row.hidden,
  vcs: row.vcs, defaultBranch: row.defaultBranch, remoteUrl: row.remoteUrl,
})

export const taskResource = (nodeId: string, row: Task | ArchivedTask) => ({
  apiVersion, kind: 'Task' as const, nodeId, id: row.id, projectId: row.projectId,
  title: row.title, origin: row.origin, status: row.status, branch: row.branch,
  worktreePath: row.worktreePath, parentId: row.parentId,
  ...('archivedAt' in row ? { archivedAt: row.archivedAt } : {}),
})

export const pluginResources = (nodeId: string, state: NodePluginState) => state.plugins.map((row) => ({
  apiVersion, kind: 'Plugin' as const, nodeId, id: row.name, state: row.state,
  running: row.running, disabled: row.disabled, required: row.required,
  activeVersion: row.active?.version ?? null,
  installedVersion: row.installed?.version ?? null,
}))

export type AgentSessionRow = {
  id: string; taskId: string; providerId: string; profileId: string; kind: string; title: string
  runtimeState: string; attention: string; lastEventSeq: number; queuedTurns: number; createdAt: number; updatedAt: number
}

export const agentSessionResource = (nodeId: string, row: AgentSessionRow, extra: Record<string, unknown> = {}) => ({
  apiVersion, kind: 'AgentSession' as const, nodeId, id: row.id, taskId: row.taskId,
  providerId: row.providerId, profileId: row.profileId, sessionKind: row.kind,
  title: row.title, runtimeState: row.runtimeState, attention: row.attention,
  lastEventSeq: row.lastEventSeq, queuedTurns: row.queuedTurns,
  createdAt: row.createdAt, updatedAt: row.updatedAt, ...extra,
})

export const agentTurnAck = (nodeId: string, row: { id: string; sessionId: string; status: string; ordinal: number }) => ({
  apiVersion, kind: 'AgentTurnAck' as const, nodeId, id: row.id, sessionId: row.sessionId,
  status: row.status, ordinal: row.ordinal,
})

export const agentEventResource = (nodeId: string, row: { id: string; sessionId: string; turnId: string | null; seq: number; event: unknown; createdAt: number; foldedThroughSeq?: number }) => ({
  apiVersion, kind: 'AgentEvent' as const, nodeId, id: row.id, sessionId: row.sessionId,
  turnId: row.turnId, seq: row.seq, event: row.event, createdAt: row.createdAt,
  ...(row.foldedThroughSeq !== undefined ? { foldedThroughSeq: row.foldedThroughSeq } : {}),
})
