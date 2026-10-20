import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { memoryCommands } from './commands'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'
import { MEMORY_SOURCE_ID, memoryEntryPath } from '../shared/api'

// Two lazy chunks off one module, because a terminal draws the list and the detail in two panels
// (the `regions` of a source in client-core's sources registry).
const MemoryList = lazy(() => import('./MemoryCenter').then((module) => ({ default: module.MemoryList })))
const MemoryCenterDetail = lazy(() =>
  import('./MemoryCenter').then((module) => ({ default: module.MemoryCenterDetail })),
)
const MemorySettings = lazy(() => import('./MemorySettings'))
const MemoryToolCard = lazy(async () => ({ default: (await import('./MemoryToolCard')).MemoryToolCard }))

export const memoryClientPlugin: ClientPlugin = {
  name: 'memory',
  required: true,
  init: (ctx) => {
    // Register Memory search commands (./commands.ts).
    for (const contribution of memoryCommands) ctx.commands.register(contribution)
    ctx.extensions.register({
      id: 'memory.tool-card',
      point: AGENT_TOOL_CARD_POINT,
      label: 'Memory changes',
      order: 10,
      matches: ['memory_write', 'memory_delete'],
      component: MemoryToolCard,
    })
    // A Memories data source record names a project memory as `<projectId>/<name>`. Pressing one opens
    // the Memory page at that memory's route, and the list selects it.
    ctx.contentLinks.register({
      id: 'memory.entry',
      providerId: 'memory',
      parse: () => null,
      path: (target) => (typeof target.item === 'string' ? memoryEntryPath(target.item) : null),
      presentations: ['route'],
    })
    // The project-scoped Memory library is a rail source.
    ctx.sources.register({
      id: MEMORY_SOURCE_ID,
      order: 70,
      glyph: 'brain',
      label: 'Memory',
      regions: { list: MemoryList, detail: MemoryCenterDetail, scroll: true },
      // The page shows memory for the selected project.
      projectScoped: true,
      routes: [{ id: 'memory.entry', path: '/p/:projectId/memory/:name', order: 70 }],
    })
    ctx.settingsPages.register({
      id: 'memory',
      label: 'Memory',
      category: 'agents',
      scope: 'node',
      icon: 'brain',
      order: 50,
      requires: { plugin: 'memory' },
      keywords: ['memory index', 'live updates', 'standing memory'],
      sections: [{ id: 'sessions', label: 'Running sessions', rows: ['Tell running sessions when memory changes'] }],
      component: MemorySettings,
    })
  },
}
