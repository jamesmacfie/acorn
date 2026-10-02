import { readFileSync } from 'node:fs'
import type { CoreServices } from '@acorn/plugin-api/node'
import { renderMemoryIndex } from './memory'
import type { MemoryStore } from './memoryStore'

// The build embeds this file; source launches read it directly. One contract for every harness.
export const memoryContract = readFileSync(new URL('./memoryContract.md', import.meta.url), 'utf8').trim()
export const MEMORY_CAPS_KEY = 'memory:index-caps:v1'
export const DEFAULT_MEMORY_CAPS = { private: 4000, project: 12000 }

export function cappedMemoryIndex(index: string, cap: number): string {
  if (index.length <= cap) return index
  const lines = index.trimEnd().split('\n')
  const lengths = [0]
  for (const line of lines) lengths.push(lengths.at(-1)! + line.length + 1)
  for (let keep = lines.length - 1; keep >= 0; keep--) {
    const marker = `[MEMORY.md truncated: ${lines.length - keep} older entries not shown. Call memory_list to see every entry.]`
    if (lengths[keep] + marker.length <= cap) return [...lines.slice(0, keep), marker].join('\n')
  }
  return '[MEMORY.md truncated: call memory_list to see every entry.]'
}

export function standingContextBuilder(store: Pick<MemoryStore, 'list'>, core: Pick<CoreServices, 'tasks' | 'identity' | 'prefs'>) {
  return async (taskId: string): Promise<string | null> => {
    const task = await core.tasks.load(taskId)
    if (!task) return null
    const user = core.identity.active()
    let caps = { ...DEFAULT_MEMORY_CAPS }
    if (user) {
      const raw = await core.prefs.read(user, MEMORY_CAPS_KEY)
      try {
        const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>
        for (const scope of ['private', 'project'] as const) {
          const value = parsed[scope]
          if (typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 32000) caps[scope] = value
        }
      } catch { /* A damaged preference retains the defaults. */ }
    }
    const memories = await store.list(task.projectId ?? null)
    const blocks = [memoryContract, '## Private memory', cappedMemoryIndex(renderMemoryIndex(memories.filter((memory) => memory.scope === 'private')), caps.private) || '(No memories yet.)']
    if (task.projectId) blocks.push('## Project memory', cappedMemoryIndex(renderMemoryIndex(memories.filter((memory) => memory.scope === 'project')), caps.project) || '(No memories yet.)')
    return blocks.join('\n\n')
  }
}
