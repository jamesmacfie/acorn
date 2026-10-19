import { z } from 'zod'
import { panelShowInputSchema } from '@acorn/protocol/dashboards.ts'
import type { AgentToolContribution } from './registry.ts'
import type { PanelToolDeps } from './panelShow.ts'

// A chat agent drafts dashboard panels with these (docs/agent-tools.md § Panels). Only the
// declarations are on the Node's boot path; what they do loads on the first call (./panelShow.ts).

export const panelTools = (deps: PanelToolDeps): AgentToolContribution[] => [
  {
    name: 'panel_guide',
    description:
      'How to write a dashboard panel plan for panel_show: the instructions the panel studio uses, how to choose a view, and two worked examples. Read it before your first panel_show.',
    input: z.strictObject({}),
    scope: 'task',
    risk: 'read',
    handler: async (_input, ctx) => (await import('./panelShow.ts')).guideForTask(deps, ctx),
  },
  {
    name: 'panel_show',
    description:
      'Draw a dashboard panel in this conversation from a draft plan. A plan with problems draws nothing and fails with each problem and its path into the plan. Returns no records. Pass panelId to revise a panel you showed.',
    input: panelShowInputSchema,
    scope: 'task',
    risk: 'write',
    handler: async (input, ctx) => (await import('./panelShow.ts')).showPanel(deps, input, ctx),
  },
]
