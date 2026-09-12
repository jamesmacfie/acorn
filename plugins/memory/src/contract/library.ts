import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type MemoryType = 'convention' | 'architecture' | 'decision' | 'fix' | 'reference' | 'feedback' | 'task' | 'user'
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
}

export type MemoryLibraryCapability = {
  list(scope: { scope: 'project'; projectId: string } | { scope: 'private' }): Promise<MemoryLibraryEntry[]>
}

export const MEMORY_LIBRARY = capabilityId<MemoryLibraryCapability>('memory.library')
