import type { NoticeTarget } from '../chrome/notices'

/** The host's small, source-neutral view of a session for notification delivery. */
export type AttentionState = 'working' | 'blocked' | 'finished' | 'error' | 'idle'

export type AttentionSnapshot = {
  nodeId: string
  sourceId: string
  sessionId: string
  taskId: string
  title: string
  state: AttentionState
  notifyOnFinish: boolean
  target: NoticeTarget
}

export type AttentionEdgeKind = 'agent-needs-input' | 'agent-completed' | 'agent-error'

export type AttentionEdge = {
  nodeId: string
  sourceId: string
  sessionId: string
  taskId: string
  kind: AttentionEdgeKind
  state: AttentionState
  title: string
}
