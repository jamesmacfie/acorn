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
import { MEMORY_SOURCE_ID } from './proposalTarget'

// Search results and review actions open this project's Memory page.
const openMemory = (context: { projectId: string | null; navigate?: (path: string) => void }, projectId = context.projectId): void => {
  setSelectedSource(MEMORY_SOURCE_ID)
  if (projectId) context.navigate?.(projectPath(projectId))
}

export const memoryCommands: readonly ContributedCommand[] = [
  {
    id: 'memory.learnings.review',
    title: 'Review learnings',
    hint: 'suggest what to remember from this task',
    keywords: ['memory', 'findings', 'prepare', 'learnings'],
    category: 'action',
    palette: true,
    scope: 'task',
    requires: { plugin: 'findings' },
    run: async (context): Promise<CommandOutcome> => {
      if (!context.taskId) return { effect: 'stay', status: 'Choose a task first.' }
      const bundle = await memoryApi().prepare(context.taskId, `manual:${context.taskId}:${Date.now()}`)
      openMemory(context, bundle.scope.kind === 'project' ? bundle.scope.projectId : null)
      return COMMAND_CLOSED
    },
  },
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
    // The node's own full-text index, so the ordering is its rank and the host does not re-rank it.
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
  {
    id: 'memory.proposals.open',
    title: 'Review memory suggestions',
    hint: 'what an agent suggested this project should remember',
    keywords: ['memory', 'proposals', 'review'],
    category: 'navigation',
    palette: true,
    requires: { plugin: 'memory' },
    // The Memory page is project-scoped and remains useful without an active task.
    run: (context) => openMemory(context),
  },
]
