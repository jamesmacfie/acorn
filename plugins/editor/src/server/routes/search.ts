import { Hono } from 'hono'
import { z } from 'zod'
import type { SearchResult } from '../../shared/search'
import { type AppEnv, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'

// Find-in-files: project-wide text search over the task's worktree through ripgrep. The taskId in the
// path is the capability: the client never hands over a worktree path, and the bridge re-derives it
// from the DB and runs rg with cwd:root. Pure Node, so it works in dev:node.

// The node backing (../search.ts): resolve the task worktree and run ripgrep.
export type SearchBridge = {
  findInFiles(taskId: string, query: string, opts: SearchOpts): Promise<SearchResult>
}
export type SearchOpts = { caseSensitive: boolean; wholeWord: boolean; regex: boolean }

export const SEARCH = routeCapability<SearchBridge>('editor.searchRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setSearchBridge = (bridge: SearchBridge | null): void => setRouteTestCapability(SEARCH, bridge)

// Search spawns a process, so the body gets zod validation and a malformed-body test. Unknown
// keys are stripped, and toggles default to off.
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
  return viaBridge(c, SEARCH, (b) =>
    b.findInFiles(c.req.param('id'), query, {
      caseSensitive: opts?.caseSensitive ?? false,
      wholeWord: opts?.wholeWord ?? false,
      regex: opts?.regex ?? false,
    }),
  )
})
