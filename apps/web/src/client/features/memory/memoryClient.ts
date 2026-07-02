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

export type MemoryApi = {
  list(repo?: string): Promise<MemoryRow[] | { error: string }>
  search(query: string, repo?: string, type?: MemoryType): Promise<(MemoryRow & { rank: number })[] | { error: string }>
  add(p: { taskId: string; scope: 'repo' | 'private'; name: string; description: string; type: MemoryType; body: string }): Promise<{ path: string } | { error: string }>
}

export const memoryApi = (): MemoryApi | null => window.acorn?.memory ?? null
