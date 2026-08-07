import type { PaletteItem } from '@acorn/client-core/palette/model.ts'
import type { PaletteRowSource } from '@acorn/client-core/registries/paletteRows.ts'
import { workflowApi, type WorkflowDefSummary } from '../contract/workflowClient'

// The defs a `rows` fetch returned, so `invoke` can start the picked one without a second request.
let lastDefs: { taskId: string; workflows: WorkflowDefSummary[] } | null = null

export const workflowsPaletteRowSource: PaletteRowSource = {
  id: 'workflows.defs',
  // After terminal's run/layout rows, matching the order the palette produced when it composed all three
  // itself (run, layout, workflow).
  order: 20,
  // Desktop-only: the runner is a main-process engine, so these routes 503 under dev:node.
  requires: 'terminal',
  rows: async (taskId) => {
    if (!taskId) return { rows: [] }
    const defs = await workflowApi.defs(taskId)
    lastDefs = { taskId, workflows: defs.workflows }
    return {
      rows: defs.workflows.map((w): PaletteItem => ({
        kind: 'workflow',
        id: `workflow:${w.id}`,
        label: `Workflow: ${w.name}`,
        hint: `${w.steps.length} steps`,
      })),
      errors: defs.errors,
    }
  },
  invoke: async (item, taskId) => {
    if (!taskId || item.kind !== 'workflow') return
    const def = lastDefs?.taskId === taskId ? lastDefs.workflows.find((w) => `workflow:${w.id}` === item.id) : undefined
    if (!def) return
    // `start` already converts a thrown HTTP error into `{ error }` and handles the needs-trust prompt, so the
    // result passes straight through to the palette's error line.
    return await workflowApi.start(taskId, def)
  },
}
