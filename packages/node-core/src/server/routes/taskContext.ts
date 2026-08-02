import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { assembleContext, parseInclude } from '../agentTools/contextSections'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'

// Task context HTTP surface (docs/agent-tools.md §4): a thin route over the shared section registry
// (../agentTools/contextSections.ts). Both delivery paths compose from that ONE assembler — push
// (formatContextBlock → sendToAgent) fetches this route; pull is the MCP task_context tool. The
// context-read agent tools call assembleContext directly (no self-fetch). Also serves repo facts
// for the repo_info tool.

export const taskContext = new Hono<AppEnv>()
  // Repo facts for the repo_info tool (docs/mcp.md): owner/name/defaultBranch off the mirror.
  .get('/:id/repo-info', async (c) => {
    const user = getUser(c)
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, c.req.param('id')))
    if (!t) return respondError(c, 404, 'not_found')
    const [repoRow] = await db
      .select()
      .from(schema.repos)
      .where(and(eq(schema.repos.userId, user.login), eq(schema.repos.owner, t.repoOwner), eq(schema.repos.name, t.repoName)))
    return c.json({ owner: t.repoOwner, name: t.repoName, defaultBranch: repoRow?.defaultBranch ?? null, branch: t.branch, worktreePath: t.worktreePath })
  })
  .get('/:id/context', async (c) => {
    const ctx = await assembleContext(getDb(c.env), getUser(c).login, c.req.param('id'), parseInclude(c.req.query('include')), {
      workflowRunId: c.req.query('workflowRunId'),
    })
    if (!ctx) return respondError(c, 404, 'not_found')
    return c.json(ctx)
  })
