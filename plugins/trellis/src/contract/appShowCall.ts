import { z } from 'zod'
import { toolCallJson } from '@acorn/protocol/toolCallJson.ts'

// `app_show`'s input and result: what the Node's tool checks, and what the app card and the browser
// bridge read back from a transcript. No lang-core here, because the CLI bundles this.

export const appIdSchema = z.string().regex(/^app-[0-9a-f]{12}$/, 'An app id looks like app-0123456789ab.')
export const appShowInput = z.strictObject({ appId: appIdSchema, note: z.string().trim().min(1).max(200) })
type AppShowInput = z.infer<typeof appShowInput>

/** What `app_show` returns. */
const appShowResultSchema = z.object({
  appId: appIdSchema,
  name: z.string(),
  revision: z.number().int().positive(),
})
export type AppShowResult = z.infer<typeof appShowResultSchema>

/** An `app_show` call as a transcript recorded it, with whichever of its input and result parse. */
export function readAppShowCall(tool: { input?: string; output?: string }): {
  input?: AppShowInput
  result?: AppShowResult
} {
  const input = appShowInput.safeParse(toolCallJson(tool.input))
  const result = appShowResultSchema.safeParse(toolCallJson(tool.output))
  return { ...(input.success ? { input: input.data } : {}), ...(result.success ? { result: result.data } : {}) }
}
