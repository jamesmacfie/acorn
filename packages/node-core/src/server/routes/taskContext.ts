import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { assembleContext, parseInclude } from '../agentTools/contextSections'
import { getDb, schema } from '../db'
import { repoMirrorSource } from '../repoMirror'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'

// Task context HTTP surface (docs/agent-tools.md §4): a thin route over the shared section registry
// (../agentTools/contextSections.ts). Both delivery paths compose from that ONE assembler — push
// (formatContextBlock → sendToAgent) fetches this route; pull is the MCP task_context tool. The
// context-read agent tools call assembleContext directly (no self-fetch). Also serves repo facts
// for the repo_info tool.

export const taskContext = new Hono<AppEnv>()
  // Repo facts for the repo_info tool (docs/mcp.md): owner/name/branch/worktree off core's `tasks`, plus
  // the default branch, which only GitHub knows and which therefore comes from the mirror slot
  // (server/repoMirror.ts). `null` already had to be a valid answer here — an unmirrored repo produced no
  // row before — so a cold mirror or a disabled github plugin degrades into a case the tool handles.
  .get('/:id/repo-info', async (c) => {
    const uid = ownerId(c)
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, c.req.param('id')))
    if (!t) return respondError(c, 404, 'not_found')
    const defaultBranch = await repoMirrorSource().defaultBranch(uid, t.repoOwner, t.repoName)
    return c.json({ owner: t.repoOwner, name: t.repoName, defaultBranch, branch: t.branch, worktreePath: t.worktreePath })
  })
  .get('/:id/context', async (c) => {
    const ctx = await assembleContext(getDb(c.env), ownerId(c), c.req.param('id'), parseInclude(c.req.query('include')), {
      workflowRunId: c.req.query('workflowRunId'),
    })
    if (!ctx) return respondError(c, 404, 'not_found')
    return c.json(ctx)
  })
