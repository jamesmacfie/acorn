import { activeNodeId, readBytes, readJson, sendForm, writeJson } from '@acorn/plugin-api/client'
import type {
  AgentAttachment,
  AgentArtifact,
  AgentDeleteResult,
  AgentEventPage,
  AgentFootprint,
  AgentProviderDescriptor,
  AgentRequest,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '../../contract/wire.ts'
import type {
  CreateAgentSessionInput,
  EnqueueAgentTurnInput,
  ImportAgentTranscriptInput,
} from '../../shared/schemas'
import type { AgentSessionMcp } from '../../shared/mcpServers'
import { MAX_INLINE_IMAGE_BYTES } from './inlineImage'

export type AgentOrigin = { nodeId?: string | null; signal?: AbortSignal }

const ROOT = '/v1/p/agents'
const sessionRoute = (sessionId: string, suffix = '') =>
  `${ROOT}/sessions/${encodeURIComponent(sessionId)}${suffix}`

const jsonWrite = <T>(url: string, method: string, body?: unknown, idempotent: boolean | string = false, options: AgentOrigin = {}): Promise<T> =>
  writeJson<T>(url, {
    ...options,
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotent ? { 'idempotency-key': typeof idempotent === 'string' ? idempotent : crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const managedAgentApi = {
  providers: (force = false, options: AgentOrigin = {}) =>
    readJson<AgentProviderDescriptor[]>(`${ROOT}/providers${force ? '?force=true' : ''}`, options),
  // Settings > Storage and memory. At a named node, because the page says which node it shows.
  footprint: (options: { nodeId?: string } = {}) => readJson<AgentFootprint>(`${ROOT}/footprint`, options),
  stopIdle: (options: { nodeId?: string } = {}) =>
    writeJson<{ stopped: number }>(`${ROOT}/stop-idle`, { method: 'POST', ...options }),
  async uploadAttachment(taskId: string, file: File, options: AgentOrigin = {}): Promise<AgentAttachment> {
    const origin = { ...options, nodeId: options.nodeId === undefined ? activeNodeId() : options.nodeId }
    // The parts are described rather than encoded: main builds the real multipart body, so nothing here
    // hand-rolls a boundary and the upload rides the same pinned connection as every other request.
    return sendForm<AgentAttachment>(
      `${ROOT}/attachments?taskId=${encodeURIComponent(taskId)}`,
      [{ name: 'file', filename: file.name, type: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) }],
      'Unable to upload attachment.',
      origin,
    )
  },
  attachment: (attachmentId: string, options: AgentOrigin = {}) =>
    readJson<AgentAttachment>(`${ROOT}/attachments/${encodeURIComponent(attachmentId)}`, options),
  removeAttachment: (attachmentId: string, options: AgentOrigin = {}) =>
    jsonWrite<{ removed: boolean }>(`${ROOT}/attachments/${encodeURIComponent(attachmentId)}`, 'DELETE', undefined, false, options),
  // Bytes, not a URL, for the reason artifactContent gives below.
  attachmentContent: (attachmentId: string, options: AgentOrigin = {}) =>
    readBytes(`${ROOT}/attachments/${encodeURIComponent(attachmentId)}/content`, 'Unable to read attachment.', options),
  attachmentPreview: (attachmentId: string, options: AgentOrigin = {}) =>
    readBytes(`${ROOT}/attachments/${encodeURIComponent(attachmentId)}/content`, 'Unable to read attachment preview.', { ...options, maxResponseBytes: MAX_INLINE_IMAGE_BYTES }),
  artifacts: (sessionId: string) =>
    readJson<AgentArtifact[]>(sessionRoute(sessionId, '/artifacts')),
  artifact: (artifactId: string, options: AgentOrigin = {}) =>
    readJson<AgentArtifact>(`${ROOT}/artifacts/${encodeURIComponent(artifactId)}`, options),
  // Bytes, not a URL. There's no origin the browser could fetch an artifact from: under app:// a
  // route-builder path resolves against the client's own protocol handler, and only the broker holds
  // the device bearer. The caller turns this into a blob URL for the download.
  artifactContent: (artifactId: string, options: AgentOrigin = {}) =>
    readBytes(`${ROOT}/artifacts/${encodeURIComponent(artifactId)}/content`, 'Unable to download artifact.', options),
  artifactPreview: (artifactId: string, options: AgentOrigin = {}) =>
    readBytes(`${ROOT}/artifacts/${encodeURIComponent(artifactId)}/content`, 'Unable to read artifact preview.', { ...options, maxResponseBytes: MAX_INLINE_IMAGE_BYTES }),
  // Explicit origin options bind continuation reads and delayed draft/media work to their Node.
  // Omitting the origin retains the active-Node behavior for synchronous surface actions.
  sessions: (
    filter: { taskId?: string; workspaceId?: string; attention?: boolean; archived?: boolean } = {},
    options: AgentOrigin = {},
  ) => {
    const query = new URLSearchParams()
    if (filter.taskId) query.set('taskId', filter.taskId)
    if (filter.workspaceId) query.set('workspaceId', filter.workspaceId)
    if (filter.attention != null) query.set('attention', String(filter.attention))
    if (filter.archived != null) query.set('archived', String(filter.archived))
    return readJson<AgentSessionList>(`${ROOT}/sessions?${query}`, options)
  },
  search: (
    query: string,
    filter: { taskId?: string; workspaceId?: string; limit?: number } = {},
    options: AgentOrigin = {},
  ) => {
    const params = new URLSearchParams({ q: query, limit: String(filter.limit ?? 100) })
    if (filter.taskId) params.set('taskId', filter.taskId)
    if (filter.workspaceId) params.set('workspaceId', filter.workspaceId)
    return readJson<AgentSession[]>(`${ROOT}/sessions/search?${params}`, options)
  },
  createSession: (input: CreateAgentSessionInput, idempotencyKey?: string, options: AgentOrigin = {}) =>
    jsonWrite<AgentSession>(`${ROOT}/sessions`, 'POST', input, idempotencyKey ?? true, options),
  importTranscript: (input: ImportAgentTranscriptInput) =>
    jsonWrite<AgentSession>(`${ROOT}/transcript-imports`, 'POST', input),
  // `fold=1`: this reader takes one record per tool call and pages on from `foldedThroughSeq`
  // (../../shared/toolFold.ts). A node that predates it ignores the flag and sends every row.
  snapshot: (sessionId: string, afterSeq = 0, limit = 2_000, options: AgentOrigin = {}) =>
    readJson<AgentSessionSnapshot>(sessionRoute(sessionId, `?afterSeq=${afterSeq}&limit=${limit}&fold=1`), options),
  events: (sessionId: string, afterSeq: number, limit = 2_000, options: AgentOrigin = {}) =>
    readJson<AgentEventPage>(sessionRoute(sessionId, `/events?afterSeq=${afterSeq}&limit=${limit}&fold=1`), options),
  enqueue: (sessionId: string, input: Omit<EnqueueAgentTurnInput, 'idempotencyKey'>, idempotencyKey?: string, options: AgentOrigin = {}) =>
    jsonWrite<AgentTurn>(sessionRoute(sessionId, '/turns'), 'POST', input, idempotencyKey ?? true, options),
  implementPlan: (sessionId: string, itemId: string) =>
    jsonWrite<AgentTurn>(sessionRoute(sessionId, '/implement-plan'), 'POST', { itemId }),
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
  patch: (sessionId: string, patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> }, options: AgentOrigin = {}) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId), 'PATCH', patch, false, options),
  remove: (sessionId: string) => jsonWrite<AgentDeleteResult>(sessionRoute(sessionId), 'DELETE'),
  fork: (sessionId: string, title?: string) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId, '/fork'), 'POST', title ? { title } : {}),
  compact: (sessionId: string) =>
    jsonWrite<{ ok: true }>(sessionRoute(sessionId, '/compact'), 'POST'),
  mcp: (sessionId: string) => readJson<AgentSessionMcp>(sessionRoute(sessionId, '/mcp')),
  setMcp: (sessionId: string, enabled: string[]) =>
    jsonWrite<AgentSessionMcp>(sessionRoute(sessionId, '/mcp'), 'PUT', { enabled }),
  regenerateTitle: (sessionId: string) =>
    jsonWrite<AgentSession>(sessionRoute(sessionId, '/regenerate-title'), 'POST'),
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
