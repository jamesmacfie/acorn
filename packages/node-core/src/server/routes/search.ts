import { Hono } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import { SEARCH_MIN_LENGTH, type SearchGroup, type SearchResponse } from '@acorn/protocol/search.ts'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { SEARCH_HITS_MAX, searchProviders } from '../pluginHost/search'

// Search across core and every plugin's provider (docs/plugins.md § Search providers).
//
// `?q=` is the text, `?archived=1` searches archived tasks instead of active ones, and `?workspaceId=`
// narrows to one workspace. Core resolves that into task ids once, so every provider gets the same
// scope and none has to know what archived means. Device-only, by mount (server/index.ts).
export const search = new Hono<AppEnv>().get('/', async (c) => {
  const text = (c.req.query('q') ?? '').trim()
  if (text.length < SEARCH_MIN_LENGTH) return c.json({ groups: [] } satisfies SearchResponse)
  const db = getDb(c.env)
  const workspaceId = c.req.query('workspaceId')
  const inWorkspace = workspaceId
    ? inArray(schema.tasks.projectId, db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.workspaceId, workspaceId)))
    : undefined
  const rows = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title, branch: schema.tasks.branch })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, c.req.query('archived') === '1' ? 'archived' : 'active'), inWorkspace))

  // Core's own provider. Titles and branches are a few hundred short rows, so a substring scan in
  // memory is well under a millisecond and needs no index.
  const needle = text.toLowerCase()
  const tasks: SearchGroup = {
    providerId: 'core:tasks',
    label: 'Tasks',
    status: 'ok',
    hits: rows
      .filter((row) => row.title.toLowerCase().includes(needle) || row.branch?.toLowerCase().includes(needle))
      .slice(0, SEARCH_HITS_MAX)
      .map((row) => ({ taskId: row.id, title: row.title, preview: row.branch ?? '' })),
  }
  const plugins = rows.length
    ? await searchProviders({ text, limit: SEARCH_HITS_MAX, taskIds: rows.map((row) => row.id) })
    : []
  return c.json({ groups: [tasks, ...plugins] } satisfies SearchResponse)
})
