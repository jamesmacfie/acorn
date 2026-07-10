import { Hono } from 'hono'
import { z } from 'zod'
import type { SearchResult } from '../../shared/search'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { respondError } from '../../../../core/server/respond'

// Find-in-files (docs/panes.md): project-wide text search over the task's worktree via ripgrep.
// Was the `search:findInFiles` IPC channel (inventories §1a). The taskId in the path is the
// capability — the renderer never hands us a worktree path; the bridge re-derives it from the DB
// and runs rg with cwd:root. Server-backed and pure-Node, so it works in dev:node too.

// The main-process backing (main/search.ts): resolve the task worktree + run ripgrep.
export type SearchBridge = {
  findInFiles(taskId: string, query: string, opts: SearchOpts): Promise<SearchResult>
}
export type SearchOpts = { caseSensitive: boolean; wholeWord: boolean; regex: boolean }

export const searchBridgeSlot = bridgeSlot<SearchBridge>()
export const setSearchBridge = searchBridgeSlot.set

// Search spawns a process, so the body is validated (Phase 3 §1: bodies that spawn processes get a
// zod schema + a malformed-body test). Unknown keys are stripped, toggles default to off.
const searchBody = z.object({
  query: z.string().min(1),
  opts: z
    .object({ caseSensitive: z.boolean(), wholeWord: z.boolean(), regex: z.boolean() })
    .partial()
    .optional(),
})

export const search = new Hono<AppEnv>().post('/:id/search', async (c) => {
  const parsed = searchBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return respondError(c, 400, 'bad_request')
  const { query, opts } = parsed.data
  return viaBridge(c, searchBridgeSlot, (b) =>
    b.findInFiles(c.req.param('id'), query, {
      caseSensitive: opts?.caseSensitive ?? false,
      wholeWord: opts?.wholeWord ?? false,
      regex: opts?.regex ?? false,
    }),
  )
})
