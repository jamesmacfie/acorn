import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  projectPath,
  setSelectedSource,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { selectMemory } from './memorySelection'
import { memoryApi } from './memoryClient'
import { MEMORY_SOURCE_ID } from '../shared/api'

// Search results open this project's Memory page.
const openMemory = (context: { projectId: string | null; navigate?: (path: string) => void }, projectId = context.projectId): void => {
  setSelectedSource(MEMORY_SOURCE_ID)
  if (projectId) context.navigate?.(projectPath(projectId))
}

export const memoryCommands: readonly ContributedCommand[] = [
  {
    id: 'memory.search',
    kind: 'search',
    title: 'Search memory',
    hint: 'what this project has learned',
    keywords: ['memory', 'knowledge', 'convention'],
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'memory' },
    placeholder: 'Search project memory…',
    // The Node searches current files and orders the matches by relevance.
    // Debounce and minimum query stay at the defaults: every keystroke here is a request.
    query: async (text, context) => {
      const found = await memoryApi().search(text, context.projectId ?? undefined)
      if ('error' in found) throw new Error(found.error)
      return found.map((memory): CommandSearchItem => ({
        id: memory.id,
        title: memory.name,
        subtitle: memory.description,
        badge: memory.type,
        // Name and scope distinguish same-named private and project memories.
        ref: JSON.stringify({ name: memory.name, scope: memory.scope }),
      }))
    },
    select: (item, context): CommandOutcome => {
      if (!item.ref) return COMMAND_CLOSED
      try {
        const selected = JSON.parse(item.ref) as { name: string; scope: string }
        selectMemory(selected)
        openMemory(context)
      } catch { /* An obsolete search row is safe to ignore. */ }
      return COMMAND_CLOSED
    },
  },
]
