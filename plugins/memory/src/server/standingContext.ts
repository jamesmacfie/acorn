import { readFileSync } from 'node:fs'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { MemoryScope } from '../contract/library'
import { MEMORY_LIVE_UPDATES_KEY } from '../shared/api'
import { renderMemoryIndex } from './memory'
import type { MemoryStore } from './memoryStore'

// The build embeds this file; source launches read it directly. One contract for every harness.
const memoryContract = readFileSync(new URL('./memoryContract.md', import.meta.url), 'utf8').trim()
export const MEMORY_CAPS_KEY = 'memory:index-caps:v1'
const DEFAULT_MEMORY_CAPS = { private: 4000, project: 12000 }

function cappedMemoryIndex(index: string, cap: number): string {
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

async function memoryCaps(core: Pick<CoreServices, 'identity' | 'prefs'>) {
  const user = core.identity.active()
  const caps = { ...DEFAULT_MEMORY_CAPS }
  if (user) {
    try {
      const parsed = JSON.parse((await core.prefs.read(user, MEMORY_CAPS_KEY)) ?? '{}') as Record<string, unknown>
      for (const scope of ['private', 'project'] as const) {
        const value = parsed[scope]
        if (typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 32000) caps[scope] = value
      }
    } catch {
      /* A damaged preference retains the defaults. */
    }
  }
  return caps
}

export async function memoryPreview(
  store: Pick<MemoryStore, 'list'>,
  core: Pick<CoreServices, 'identity' | 'prefs'>,
  projectId: string | null,
  scope?: MemoryScope,
) {
  const caps = await memoryCaps(core)
  const memories = await store.list(projectId, scope)
  const indexes = {
    private: renderMemoryIndex(memories.filter((memory) => memory.scope === 'private')),
    project: renderMemoryIndex(memories.filter((memory) => memory.scope === 'project')),
  }
  const privateIndex = cappedMemoryIndex(indexes.private, caps.private)
  const projectIndex = cappedMemoryIndex(indexes.project, caps.project)
  const blocks = [memoryContract]
  if (scope !== 'project') blocks.push('## Private memory', privateIndex || '(No memories yet.)')
  if (projectId && scope !== 'private') blocks.push('## Project memory', projectIndex || '(No memories yet.)')
  return {
    text: blocks.join('\n\n'),
    caps,
    counts: { private: indexes.private.length, project: indexes.project.length },
    shown: { private: privateIndex.length, project: projectIndex.length },
  }
}

// `live` reads for a running session, so it honours the live-updates switch. The switch is on unless the
// person turned it off, because an agent working from a stale index is the worse case.
export function standingContextBuilder(
  store: Pick<MemoryStore, 'list'>,
  core: Pick<CoreServices, 'tasks' | 'identity' | 'prefs'>,
  live = false,
) {
  return async (taskId: string): Promise<string | null> => {
    const user = core.identity.active()
    if (live && user && (await core.prefs.read(user, MEMORY_LIVE_UPDATES_KEY)) === '0') return null
    const task = await core.tasks.load(taskId)
    return task ? (await memoryPreview(store, core, task.projectId ?? null)).text : null
  }
}
