// Typed accessor for the preload's `window.acorn.memory` bridge (docs/next 12). The Window global
// is declared once in terminalClient.ts.
export type MemoryType = 'convention' | 'architecture' | 'decision' | 'fix' | 'reference' | 'feedback' | 'task' | 'user'

export type MemoryRow = {
  id: string
  scope: 'repo' | 'private'
  repo: string | null
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
  repo: string | null
  name: string
  type: MemoryType
  description: string
  body: string
  // Verification flags from the auto-generation verify pass (e.g. "contradicts the existing
  // '<name>' — accepting supersedes it"). Structural — rendered as badges beside the description,
  // never folded into it. Defaulted to [] by main for proposals written before the field existed.
  flags: string[]
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

export type MemoryApi = {
  list(repo?: string): Promise<MemoryRow[] | { error: string }>
  search(query: string, repo?: string, type?: MemoryType): Promise<(MemoryRow & { rank: number })[] | { error: string }>
  add(p: { taskId: string; scope: 'repo' | 'private'; name: string; description: string; type: MemoryType; body: string }): Promise<{ path: string } | { error: string }>
  proposals(taskId?: string): Promise<MemoryProposalRow[]>
  resolveProposal(id: string, approved: boolean, edited?: { name: string; type: MemoryType; description: string; body: string }): Promise<{ ok: boolean; reason?: string }>
}

export const memoryApi = (): MemoryApi | null => window.acorn?.memory ?? null
