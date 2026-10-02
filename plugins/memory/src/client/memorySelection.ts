import { createSignal } from 'solid-js'
import { projectPath, setSelectedSource } from '@acorn/plugin-api/client'
import { MEMORY_SOURCE_ID } from '../shared/api'

export const [selectedMemory, selectMemory] = createSignal<{ name: string; scope: string } | undefined>()
export function openMemory(name: string, scope: string, projectId?: string, navigate?: (path: string) => void): void {
  selectMemory({ name, scope })
  setSelectedSource(MEMORY_SOURCE_ID)
  if (projectId) navigate?.(projectPath(projectId))
}
