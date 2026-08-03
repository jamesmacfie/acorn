import { apiError, readJson, sendForm, writeJson } from '@acorn/client-core/apiClient.ts'
import type {
  AgentAttachment,
  AgentArtifact,
  AgentDeleteResult,
  AgentEventPage,
  AgentProviderDescriptor,
  AgentRequest,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'
import type {
  CreateAgentSessionInput,
  EnqueueAgentTurnInput,
  ImportAgentTranscriptInput,
} from '../shared/schemas'

const ROOT = '/api/agents'
const sessionRoute = (sessionId: string, suffix = '') =>
  `${ROOT}/sessions/${encodeURIComponent(sessionId)}${suffix}`

const jsonWrite = <T>(url: string, method: string, body?: unknown, idempotent = false): Promise<T> =>
  writeJson<T>(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const managedAgentApi = {
  providers: (force = false) =>
    readJson<AgentProviderDescriptor[]>(`${ROOT}/providers${force ? '?force=true' : ''}`),
  async uploadAttachment(taskId: string, file: File): Promise<AgentAttachment> {
    // The parts are described rather than encoded: main builds the real multipart body, so nothing
    // here has to hand-roll a boundary and the upload rides the same pinned connection as every
    // other request.
    return sendForm<AgentAttachment>(
      `${ROOT}/attachments?taskId=${encodeURIComponent(taskId)}`,
      [{ name: 'file', filename: file.name, type: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) }],
      'Unable to upload attachment.',
    )
  },
  attachment: (attachmentId: string) =>
    readJson<AgentAttachment>(`${ROOT}/attachments/${encodeURIComponent(attachmentId)}`),
  removeAttachment: (attachmentId: string) =>
    jsonWrite<{ removed: boolean }>(`${ROOT}/attachments/${encodeURIComponent(attachmentId)}`, 'DELETE'),
  artifacts: (sessionId: string) =>
    readJson<AgentArtifact[]>(sessionRoute(sessionId, '/artifacts')),
  artifact: (artifactId: string) =>
    readJson<AgentArtifact>(`${ROOT}/artifacts/${encodeURIComponent(artifactId)}`),
  artifactContentUrl: (artifactId: string) =>
    `${ROOT}/artifacts/${encodeURIComponent(artifactId)}/content`,
  sessions: (filter: { taskId?: string; workspaceId?: string; attention?: boolean; archived?: boolean } = {}) => {
    const query = new URLSearchParams()
    if (filter.taskId) query.set('taskId', filter.taskId)
    if (filter.workspaceId) query.set('workspaceId', filter.workspaceId)
    if (filter.attention != null) query.set('attention', String(filter.attention))
    if (filter.archived != null) query.set('archived', String(filter.archived))
    return readJson<AgentSessionList>(`${ROOT}/sessions?${query}`)
  },
  search: (
    query: string,
    filter: { taskId?: string; workspaceId?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams({ q: query, limit: String(filter.limit ?? 100) })
    if (filter.taskId) params.set('taskId', filter.taskId)
    if (filter.workspaceId) params.set('workspaceId', filter.workspaceId)
    return readJson<AgentSession[]>(`${ROOT}/sessions/search?${params}`)
  },
  createSession: (input: CreateAgentSessionInput) =>
    jsonWrite<AgentSession>(`${ROOT}/sessions`, 'POST', input, true),
  importTranscript: (input: ImportAgentTranscriptInput) =>
    jsonWrite<AgentSession>(`${ROOT}/transcript-imports`, 'POST', input),
  snapshot: (sessionId: string, afterSeq = 0, limit = 2_000) =>
    readJson<AgentSessionSnapshot>(sessionRoute(sessionId, `?afterSeq=${afterSeq}&limit=${limit}`)),
  events: (sessionId: string, afterSeq: number, limit = 2_000) =>
    readJson<AgentEventPage>(sessionRoute(sessionId, `/events?afterSeq=${afterSeq}&limit=${limit}`)),
  enqueue: (sessionId: string, input: Omit<EnqueueAgentTurnInput, 'idempotencyKey'>) =>
    jsonWrite<AgentTurn>(sessionRoute(sessionId, '/turns'), 'POST', input, true),
  patchQueuedTurn: (sessionId: string, turnId: string, patch: { input?: AgentTurn['input']; ordinal?: number }) =>
    jsonWrite<AgentTurn>(
      sessionRoute(sessionId, `/turns/${encodeURIComponent(turnId)}`),
      'PATCH',
      patch,
    ),
  removeQueuedTurn: (sessionId: string, turnId: string) =>
    jsonWrite<{ ok: true }>(
      sessionRoute(sessionId, `/turns/${encodeURIComponent(turnId)}`),
      'DELETE',
    ),
  cancel: (sessionId: string, turnId?: string) =>
    jsonWrite<{ ok: true }>(sessionRoute(sessionId, '/cancel'), 'POST', turnId ? { turnId } : {}),
  resolve: (sessionId: string, requestId: string, resolution: unknown) =>
    jsonWrite<AgentRequest>(
      sessionRoute(sessionId, `/requests/${encodeURIComponent(requestId)}/resolve`),
      'POST',
      { resolution },
      true,
    ),
  patch: (sessionId: string, patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> }) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId), 'PATCH', patch),
  remove: (sessionId: string) => jsonWrite<AgentDeleteResult>(sessionRoute(sessionId), 'DELETE'),
  fork: (sessionId: string, title?: string) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId, '/fork'), 'POST', title ? { title } : {}),
  compact: (sessionId: string) =>
    jsonWrite<{ ok: true }>(sessionRoute(sessionId, '/compact'), 'POST'),
  handoff: (sessionId: string) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId, '/handoff-terminal'), 'POST'),
  resumeManaged: (sessionId: string) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId, '/resume-managed'), 'POST'),
  verifyImportedResume: (sessionId: string) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId, '/verify-imported-resume'), 'POST'),
  export: (sessionId: string, format: 'json' | 'markdown') =>
    readJson<{ format: 'json' | 'markdown'; content: string }>(
      sessionRoute(sessionId, `/export?format=${format}`),
    ),
}
