import { createSignal } from 'solid-js'
import { projectPath, setSelectedSource } from '@acorn/plugin-api/client'
import { MEMORY_SOURCE_ID } from '../shared/api'

// The list and the detail are two regions that a host mounts apart, so what they share lives here.
// Kept free of the page's imports, because the palette command loads this at startup.
export const [selectedMemory, setSelectedMemory] = createSignal<{ name: string; scope: string } | undefined>()
export const [addingMemory, setAddingMemory] = createSignal(false)
export function selectMemory(memory: { name: string; scope: string } | undefined): void {
  setAddingMemory(false)
  setSelectedMemory(memory)
}
export function openMemory(name: string, scope: string, projectId?: string, navigate?: (path: string) => void): void {
  selectMemory({ name, scope })
  setSelectedSource(MEMORY_SOURCE_ID)
  if (projectId) navigate?.(projectPath(projectId))
}

// Bumped by local writes and by the Node's change frame. Both regions refetch from it.
export const [memoryRevision, setMemoryRevision] = createSignal(0)
export const memoriesChanged = (): void => { setMemoryRevision((value) => value + 1) }
