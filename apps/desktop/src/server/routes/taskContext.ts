import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { TaskContext, TaskContextInclude } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'

// The context assembler (docs/next 11 §C): ONE endpoint composing everything attached to a task —
// the scalar PR (via the mirror), task_links → issues.data, notes and the memory-index slice
// (seams filled by M4) — reused by both delivery paths (push via formatContextBlock → sendToAgent,
// pull via the MCP task_context tool). Compact by default (the Cloudflare mantra): titles + short
// bodies, never full comment streams.

const ALL_INCLUDES: TaskContextInclude[] = ['pr', 'issues', 'notes', 'memory']

// Seams for M4 (notes 4.5, memory 4.7): the assembler composes these once they exist.
type NotesSource = (taskId: string, repo: string) => Promise<TaskContext['notes']>
type MemorySource = (taskId: string, repo: string) => Promise<TaskContext['memory']>
let notesSource: NotesSource = async () => []
let memorySource: MemorySource = async () => []
export const setContextNotesSource = (fn: NotesSource) => {
  notesSource = fn
}
export const setContextMemorySource = (fn: MemorySource) => {
  memorySource = fn
}

const parseInclude = (raw: string | undefined): Set<TaskContextInclude> => {
  if (!raw?.trim()) return new Set(ALL_INCLUDES)
  const tokens = raw.split(',').map((t) => t.trim())
  return new Set(ALL_INCLUDES.filter((k) => tokens.includes(k)))
}

export const taskContext = new Hono<AppEnv>()
  // Repo facts for the MCP repo_info tool (docs/mcp.md): owner/name/defaultBranch off the mirror.
  .get('/:id/repo-info', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const db = getDb(c.env)
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, c.req.param('id')))
    if (!t) return c.json({ error: 'not_found' }, 404)
    const [repoRow] = await db
      .select()
      .from(schema.repos)
      .where(and(eq(schema.repos.userId, user.login), eq(schema.repos.owner, t.repoOwner), eq(schema.repos.name, t.repoName)))
    return c.json({ owner: t.repoOwner, name: t.repoName, defaultBranch: repoRow?.defaultBranch ?? null, branch: t.branch, worktreePath: t.worktreePath })
  })
  .get('/:id/context', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)
  const db = getDb(c.env)
  const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, c.req.param('id')))
  if (!t) return c.json({ error: 'not_found' }, 404)
  const include = parseInclude(c.req.query('include'))
  const repo = `${t.repoOwner}/${t.repoName}`

  const ctx: TaskContext = {
    task: { id: t.id, title: t.title, repo, branch: t.branch, worktreePath: t.worktreePath, pullNumber: t.pullNumber },
    issues: [],
    notes: [],
    memory: [],
  }

  // Scalar PR → detail via the local mirror (never a live GitHub call; the mirror is what the UI
  // shows, so the agent sees the same picture).
  if (include.has('pr') && t.pullNumber != null) {
    const [repoRow] = await db
      .select()
      .from(schema.repos)
      .where(and(eq(schema.repos.userId, user.login), eq(schema.repos.owner, t.repoOwner), eq(schema.repos.name, t.repoName)))
    if (repoRow) {
      const [pr] = await db
        .select()
        .from(schema.pullRequests)
        .where(and(eq(schema.pullRequests.userId, user.login), eq(schema.pullRequests.repoId, repoRow.id), eq(schema.pullRequests.number, t.pullNumber)))
      if (pr) {
        const files = await db
          .select({ path: schema.prFiles.path })
          .from(schema.prFiles)
          .where(and(eq(schema.prFiles.userId, user.login), eq(schema.prFiles.repoId, repoRow.id), eq(schema.prFiles.number, t.pullNumber)))
        ctx.pr = { number: pr.number, title: pr.title, body: pr.body, changedFiles: files.map((f) => f.path).sort() }
      }
    }
  }

  // task_links → issues.data (docs/next 11: the link's PK tail matches the cache exactly).
  if (include.has('issues')) {
    const links = await db.select().from(schema.taskLinks).where(eq(schema.taskLinks.taskId, t.id)).orderBy(schema.taskLinks.createdAt)
    for (const link of links) {
      const [row] = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, user.login), eq(schema.issues.integrationId, link.integrationId), eq(schema.issues.identifier, link.identifier)))
      let title = link.identifier
      let detail = ''
      if (row) {
        try {
          const data = JSON.parse(row.data) as { title?: string; state?: { name?: string }; status?: string; level?: string }
          if (typeof data.title === 'string' && data.title) title = data.title
          detail = data.state?.name ?? data.status ?? data.level ?? ''
        } catch {
          // malformed cache → identifier only
        }
      }
      ctx.issues.push({ provider: link.provider, identifier: link.identifier, title, detail })
    }
  }

  if (include.has('notes')) ctx.notes = await notesSource(t.id, repo)
  if (include.has('memory')) ctx.memory = await memorySource(t.id, repo)

  return c.json(ctx)
})
