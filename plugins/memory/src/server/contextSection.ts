// The `memory` context section (docs/agent-tools.md § Context sections). The rows are this plugin's
// index, so its shape lives here rather than in core. Core keeps the assembly, the order and the
// byte ceiling.
import { formatOmitted, type PluginContextSection } from '@acorn/plugin-api/node'

export type ContextMemorySource = (taskId: string, projectId: string) => Promise<{ name: string; description: string }[]>

export function memorySection(source: ContextMemorySource): PluginContextSection {
  return {
    id: 'memory',
    order: 40,
    label: 'Project memory',
    defaultIncluded: false,
    budget: { maxItems: 30, overflow: 'index-only' },
    async assemble({ task }) {
      const memories = task.projectId ? await source(task.id, task.projectId) : []
      return {
        items: memories.map((memory) => ({ id: memory.name, kind: 'memory', label: memory.name, details: [memory.description] })),
        compatibility: { memory: memories },
      }
    },
    format(items, omitted) {
      if (!items.length) return ''
      return ['## Project memory (index — ask for bodies via memory_get)', ...items.map((item) => `- ${item.label} — ${item.details?.[0] ?? ''}`)].join('\n') + formatOmitted(omitted)
    },
  }
}
