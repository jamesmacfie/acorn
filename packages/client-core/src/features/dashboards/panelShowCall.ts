import { z } from 'zod'
import { panelShowInputSchema, type PanelShowInput, type PanelShowResult } from '@acorn/protocol/dashboards.ts'

// Read back by both clients' panel cards; kept out of the protocol module the Node boots with.
const panelShowResultSchema: z.ZodType<PanelShowResult> = z.object({
  panelId: z.string(),
  shownAt: z.number(),
  description: z.array(z.string()),
})

/** A `panel_show` call as a transcript recorded it. Text that isn't JSON, such as a pending call's or a
 *  failure's, reads as nothing; a result can arrive inside the MCP content envelope. */
export function readPanelShowCall(tool: { input?: string; output?: string }): {
  input?: PanelShowInput
  result?: PanelShowResult
} {
  const json = (text: string | undefined): unknown => {
    try {
      const value: unknown = text ? JSON.parse(text) : undefined
      const content = (value as { content?: { text?: unknown }[] } | undefined)?.content
      return Array.isArray(content)
        ? json(content.find((part) => typeof part?.text === 'string')?.text as string)
        : value
    } catch {
      return undefined
    }
  }
  const input = panelShowInputSchema.safeParse(json(tool.input))
  const result = panelShowResultSchema.safeParse(json(tool.output))
  return { ...(input.success ? { input: input.data } : {}), ...(result.success ? { result: result.data } : {}) }
}
