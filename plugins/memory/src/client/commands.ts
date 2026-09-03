import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  openPane,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { memoryApi } from './memoryClient'

// Memory in the palette: search what this project can see, and open the proposals waiting for a
// decision (docs/future/command-palette/command-catalog.md § Memory).
//
// **Both land in the Context pane.** This plugin ships no pane of its own; what it draws is a section
// inside the context pane's section point (./index.ts), and that pane already takes an intent naming a
// section and a row in it. So a memory the palette found is revealed exactly where the reader would
// have scrolled to, and the "proposals" command is the same intent without a row
// (client-core/host/registries/commands/clientEvents.ts § `context:reveal`).
//
// **Task-scoped, even though the query is about the project.** The search itself is project-visible —
// that is the node route's own scope — but the surface a row opens in belongs to a task, and a row
// that cannot be opened is not worth offering. The project the query names is the captured one.
//
// Accepting and rejecting a proposal stay in that section: each needs the proposal's body and its
// verification flags in front of the reader. Adding a memory needs a name, a type, a scope and a body,
// which is four fields rather than one line (docs/future/command-palette/refused.md).

const CONTEXT_PANE = 'context'
const MEMORY_SECTION = 'memory'

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
    title: 'Review memory proposals',
    hint: 'what an agent suggested this project should remember',
    keywords: ['memory', 'proposals', 'review'],
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'memory' },
    // The same fold the search reveals into, with no row named: the proposals are drawn at the top of
    // it, which is where this plugin's own section puts them.
    run: (context) => {
      const taskId = context.taskId
      if (taskId) openPane(taskId, CONTEXT_PANE, { kind: 'context:reveal', sectionId: MEMORY_SECTION })
    },
  },
]
