import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  openPane,
  projectPath,
  setSelectedSource,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { memoryApi } from './memoryClient'
import { MEMORY_SOURCE_ID } from './proposalTarget'

// Memory in the palette: search what this project can see and open canonical review.
//
// A search hit is a
// memory this task's context could be drawing on, so it reveals in the Context pane's memory section:
// the reader is shown it where they are already working (client-core/host/registries/commands/
// clientEvents.ts § `context:reveal`). Review opens the Memory page.
//
// Only search is task-scoped. The search itself is project-visible, that is the
// node route's own scope, but the surface a hit opens in belongs to a task and a row that cannot be
// opened is not worth offering. The project the query names is the captured one.
//
// Review actions stay on the Memory page, with the candidate body in front of the reader.
// Adding a memory needs a name, a type, a scope and a body,
// which is four fields rather than one line (docs/command-palette-and-shortcuts.md § What the palette refuses).

const CONTEXT_PANE = 'context'
const MEMORY_SECTION = 'memory'
const openMemory = (context: { projectId: string | null; navigate?: (path: string) => void }, projectId = context.projectId): void => {
  setSelectedSource(MEMORY_SOURCE_ID)
  if (projectId) context.navigate?.(projectPath(projectId))
}

export const memoryCommands: readonly ContributedCommand[] = [
  {
    id: 'memory.learnings.review',
    title: 'Review learnings',
    hint: 'prepare suggestions from this task’s findings',
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
        // The context section keys its rows by the memory's name, not its id
        // (../server/contextSection.ts), so that is what the reveal has to name.
        ref: memory.name,
      }))
    },
    select: (item, context): CommandOutcome => {
      const taskId = context.taskId
      if (!taskId || !item.ref) return COMMAND_CLOSED
      openPane(taskId, CONTEXT_PANE, { kind: 'context:reveal', sectionId: MEMORY_SECTION, itemId: item.ref })
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
