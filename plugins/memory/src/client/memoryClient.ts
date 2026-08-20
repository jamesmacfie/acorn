// The renderer's memory surface (docs/notes-and-memory.md). Was the `window.acorn.memory` preload
// bridge, now loopback HTTP. Backed by the main-process memory index, so it 503s in dev:node.
import { memoryAddRoute, memoryListRoute, memoryProposalsRoute, memoryResolveProposalRoute, memorySearchRoute } from '../shared/api'
import { readJson, writeJson } from '@acorn/plugin-api/client'

export type MemoryType = 'convention' | 'architecture' | 'decision' | 'fix' | 'reference' | 'feedback' | 'task' | 'user'

export type MemoryRow = {
  id: string
  scope: 'project' | 'private'
  projectId: string | null
  name: string
  type: MemoryType
  description: string
  body: string
  path: string
  originSessionId: string | null
  commitSha: string | null
  supersededBy: string | null
  createdAt: number
  updatedAt: number
}

export type MemoryProposalRow = {
  id: string
  taskId: string
  projectId: string | null
  name: string
  type: MemoryType
  description: string
  body: string
  // Verification flags from the auto-generation verify pass, such as "contradicts the existing '<name>'
  // - accepting supersedes it". Structural, rendered as badges beside the description and never folded
  // into it. Defaulted to [] by main for proposals written before the field existed.
  flags: string[]
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

export type MemoryApi = {
  list(projectId?: string): Promise<MemoryRow[] | { error: string }>
  search(query: string, projectId?: string, type?: MemoryType): Promise<(MemoryRow & { rank: number })[] | { error: string }>
  add(p: { taskId: string; scope: 'project' | 'private'; name: string; description: string; type: MemoryType; body: string }): Promise<{ path: string } | { error: string }>
  // `options` is the fleet escape hatch (client-core's node/fanout.ts): the attention inbox asks every
  // paired node for its pending proposals, so this one read has to be addressable. Everything else here
  // stays on the ambient active node.
  proposals(taskId?: string, options?: { nodeId?: string; signal?: AbortSignal }): Promise<MemoryProposalRow[]>
  resolveProposal(id: string, approved: boolean, edited?: { name: string; type: MemoryType; description: string; body: string }): Promise<{ ok: boolean; reason?: string }>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const api: MemoryApi = {
  list: (projectId) => readJson<MemoryRow[] | { error: string }>(memoryListRoute(projectId)),
  search: (query, projectId, type) => readJson<(MemoryRow & { rank: number })[] | { error: string }>(memorySearchRoute(query, projectId, type)),
  add: (p) => post<{ path: string } | { error: string }>(memoryAddRoute(p.taskId), { scope: p.scope, name: p.name, description: p.description, type: p.type, body: p.body }),
  proposals: (taskId, options) => readJson<MemoryProposalRow[]>(memoryProposalsRoute(taskId), options ?? {}),
  resolveProposal: (id, approved, edited) => post<{ ok: boolean; reason?: string }>(memoryResolveProposalRoute(id), { approved, edited }),
}

export const memoryApi = (): MemoryApi => api
