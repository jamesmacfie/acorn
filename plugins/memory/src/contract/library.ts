import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type MemoryType = 'convention' | 'architecture' | 'decision' | 'fix' | 'reference' | 'feedback' | 'task' | 'user' | 'project'
export type MemoryScope = 'project' | 'private'

export type MemoryLibraryEntry = {
  id: string
  scope: MemoryScope
  projectId: string | null
  name: string
  type: MemoryType
  description: string
  body: string
  createdAt: number
  updatedAt: number
  updatedBy?: string
}

export type MemoryLibraryCapability = {
  list(scope: { scope: 'project'; projectId: string } | { scope: 'private' }): Promise<MemoryLibraryEntry[]>
}

export const MEMORY_LIBRARY = capabilityId<MemoryLibraryCapability>('memory.library')

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
  updatedBy?: string
}
