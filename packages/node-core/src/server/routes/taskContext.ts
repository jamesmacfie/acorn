import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { assembleContext, parseInclude } from '../agentTools/contextSections'
import { getDb, schema } from '../db'
import { projectForTask } from '../../main/taskWorktree'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { respondError } from '../respond'

// Task context HTTP surface (docs/agent-tools.md §4): a thin route over the shared section registry
// (../agentTools/contextSections.ts). Both delivery paths compose from that ONE assembler — push
// (formatContextBlock → sendToAgent) fetches this route; pull is the MCP task_context tool. The
// context-read agent tools call assembleContext directly (no self-fetch). Also serves repo facts
// for the repo_info tool.

export const taskContext = new Hono<AppEnv>()
  // Project facts for the repo_info tool (docs/mcp.md): GitHub owner/name comes from the optional
  // project facet, while branch/worktree and the default branch remain task/project state.
  .get('/:id/repo-info', async (c) => {
    ownerId(c)
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, c.req.param('id')))
    if (!t) return respondError(c, 404, 'not_found')
    const project = await projectForTask(db, t)
    const defaultBranch = project?.defaultBranch ?? null
    return c.json({ owner: project?.githubOwner ?? null, name: project?.githubName ?? null, projectId: project?.id ?? t.projectId, projectName: project?.name ?? null, defaultBranch, branch: t.branch, worktreePath: t.worktreePath })
  })
  .get('/:id/context', async (c) => {
    const ctx = await assembleContext(getDb(c.env), ownerId(c), c.req.param('id'), parseInclude(c.req.query('include')), {
      workflowRunId: c.req.query('workflowRunId'),
    })
    if (!ctx) return respondError(c, 404, 'not_found')
    return c.json(ctx)
  })
