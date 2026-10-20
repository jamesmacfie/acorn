import { z } from 'zod'
import { toolCallJson } from '../agents/toolCallJson'
import { panelShowInputSchema, type PanelShowInput, type PanelShowResult } from './panels'

// Read back by both clients' panel cards and the browser bridge; kept out of panels.ts, which the Node
// boots with.
const panelShowResultSchema: z.ZodType<PanelShowResult> = z.object({
  panelId: z.string(),
  shownAt: z.number(),
  description: z.array(z.string()),
})

/** A `panel_show` call as a transcript recorded it, with whichever of its input and result parse. */
export function readPanelShowCall(tool: { input?: string; output?: string }): {
  input?: PanelShowInput
  result?: PanelShowResult
} {
  const input = panelShowInputSchema.safeParse(toolCallJson(tool.input))
  const result = panelShowResultSchema.safeParse(toolCallJson(tool.output))
  return { ...(input.success ? { input: input.data } : {}), ...(result.success ? { result: result.data } : {}) }
}
