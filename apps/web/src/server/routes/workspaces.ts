import { randomUUID } from 'node:crypto'
import { and, eq, inArray, max, notInArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import type { SetupTrigger, Workspace, WorkspaceRepo, WorkspaceSeed } from '../../shared/api'

// Workspaces (docs/workspaces): named GROUPS of repos — the top-level unit. Machine-scoped (no
// user_id) like tasks / repo_paths, but auth-gated. A repo belongs to exactly one workspace
// (workspace_repos PK is (owner, repo)); the `Default` workspace is the catch-all.

async function listWorkspaces(db: ReturnType<typeof getDb>): Promise<Workspace[]> {
  const rows = await db.select().from(schema.workspaces).orderBy(schema.workspaces.sort)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const repoRows = await db.select().from(schema.workspaceRepos).where(inArray(schema.workspaceRepos.workspaceId, ids))
  // Ignored repos keep their membership but are hidden from the main UI (selector / rail / scoping).
  const ignored = new Set((await db.select().from(schema.ignoredRepos)).map((i) => `${i.owner}/${i.repo}`))
  const byWs = new Map<string, WorkspaceRepo[]>()
  for (const r of repoRows) {
    if (ignored.has(`${r.repoOwner}/${r.repoName}`)) continue
    const list = byWs.get(r.workspaceId) ?? []
    list.push({ owner: r.repoOwner, name: r.repoName, sort: r.sort })
    byWs.set(r.workspaceId, list)
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    sort: r.sort,
    setupScript: r.setupScript,
    setupScriptTrigger: r.setupScriptTrigger as Workspace['setupScriptTrigger'],
    repos: (byWs.get(r.id) ?? []).sort((a, b) => a.sort - b.sort),
  }))
}

async function ensureDefault(db: ReturnType<typeof getDb>): Promise<string> {
  const existing = await db.select().from(schema.workspaces).where(eq(schema.workspaces.isDefault, true)).limit(1)
  if (existing[0]) return existing[0].id
  const now = Date.now()
  const id = randomUUID()
  await db.insert(schema.workspaces).values({ id, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  return id
}

export const workspaces = new Hono<AppEnv>()
  .get('/', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    return c.json(await listWorkspaces(getDb(c.env)))
  })
  // Idempotent first-run setup: create Default and assign every mirrored repo not yet in a workspace.
  .post('/bootstrap', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const db = getDb(c.env)
    const defaultId = await ensureDefault(db)
    const repos = await db.select().from(schema.repos).where(eq(schema.repos.userId, user.login))
    const mapped = await db.select().from(schema.workspaceRepos)
    const ignored = await db.select().from(schema.ignoredRepos)
    const skip = new Set([...mapped.map((m) => `${m.repoOwner}/${m.repoName}`), ...ignored.map((i) => `${i.owner}/${i.repo}`)])
    const now = Date.now()
    const toAdd = repos
      .filter((r) => !skip.has(`${r.owner}/${r.name}`))
      .map((r, i) => ({ workspaceId: defaultId, repoOwner: r.owner, repoName: r.name, sort: i, createdAt: now }))
    if (toAdd.length) await db.insert(schema.workspaceRepos).values(toAdd).onConflictDoNothing()
    return c.json(await listWorkspaces(db))
  })
  .post('/', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const body = (await c.req.json().catch(() => ({}))) as Partial<WorkspaceSeed>
    if (!body.name?.trim()) return c.json({ error: 'bad_request' }, 400)
    const db = getDb(c.env)
    const [{ value }] = await db.select({ value: max(schema.workspaces.sort) }).from(schema.workspaces)
    const now = Date.now()
    const id = randomUUID()
    await db.insert(schema.workspaces).values({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, createdAt: now, updatedAt: now })
    return c.json({ id, name: body.name.trim(), isDefault: false, sort: (value ?? -1) + 1, setupScript: null, setupScriptTrigger: null, repos: [] } satisfies Workspace)
  })
  // Update a workspace's name, worktree setup script, and/or when it runs. Blank script ⇒ null.
  .patch('/:id', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; setupScript?: string; setupScriptTrigger?: SetupTrigger }
    const set: { name?: string; setupScript?: string | null; setupScriptTrigger?: string; updatedAt: number } = { updatedAt: Date.now() }
    if (body.name !== undefined) {
      if (!body.name.trim()) return c.json({ error: 'bad_request' }, 400)
      set.name = body.name.trim()
    }
    if (body.setupScript !== undefined) set.setupScript = body.setupScript.trim() || null
    if (body.setupScriptTrigger !== undefined) {
      if (!['off', 'created', 'terminal'].includes(body.setupScriptTrigger)) return c.json({ error: 'bad_request' }, 400)
      set.setupScriptTrigger = body.setupScriptTrigger
    }
    if (set.name === undefined && set.setupScript === undefined && set.setupScriptTrigger === undefined) return c.json({ error: 'bad_request' }, 400)
    await getDb(c.env).update(schema.workspaces).set(set).where(eq(schema.workspaces.id, c.req.param('id')))
    return c.json({ ok: true })
  })
  .delete('/:id', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const id = c.req.param('id')
    const db = getDb(c.env)
    const row = (await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1))[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    if (row.isDefault) return c.json({ error: 'cannot_delete_default' }, 400)
    const defaultId = await ensureDefault(db)
    // Reassign this workspace's repos back to Default rather than orphaning them.
    await db.update(schema.workspaceRepos).set({ workspaceId: defaultId }).where(eq(schema.workspaceRepos.workspaceId, id))
    await db.delete(schema.workspaceLinearProjects).where(eq(schema.workspaceLinearProjects.workspaceId, id))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id))
    return c.json({ ok: true })
  })
  // Move a repo into this workspace (partition: upsert on (owner, repo)). Also clears any ignore
  // flag — assigning a repo to a workspace un-ignores it.
  .post('/:id/repos', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { owner?: string; name?: string; sort?: number }
    if (!body.owner || !body.name) return c.json({ error: 'bad_request' }, 400)
    const db = getDb(c.env)
    const now = Date.now()
    await db.delete(schema.ignoredRepos).where(and(eq(schema.ignoredRepos.owner, body.owner), eq(schema.ignoredRepos.repo, body.name)))
    await db
      .insert(schema.workspaceRepos)
      .values({ workspaceId: id, repoOwner: body.owner, repoName: body.name, sort: body.sort ?? 0, createdAt: now })
      .onConflictDoUpdate({ target: [schema.workspaceRepos.repoOwner, schema.workspaceRepos.repoName], set: { workspaceId: id } })
    return c.json({ ok: true })
  })
  // Per-repo assignment map for the onboarding modal: every mapped repo's workspace + ignored flag.
  // Drives both the workspace dropdown and the hide toggle (membership is kept while hidden, so the
  // greyed row still shows which workspace the repo belongs to).
  .get('/assignments', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const db = getDb(c.env)
    const rows = await db.select().from(schema.workspaceRepos)
    const ignored = new Set((await db.select().from(schema.ignoredRepos)).map((i) => `${i.owner}/${i.repo}`))
    return c.json(rows.map((r) => ({ owner: r.repoOwner, name: r.repoName, workspaceId: r.workspaceId, ignored: ignored.has(`${r.repoOwner}/${r.repoName}`) })))
  })
  // Hide a repo (keeps its workspace membership; just flags it ignored so it's excluded from the
  // selector / rail / scoping). bootstrap also skips it. Reversible via /unignore-repo.
  .post('/ignore-repo', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const body = (await c.req.json().catch(() => ({}))) as { owner?: string; name?: string }
    if (!body.owner || !body.name) return c.json({ error: 'bad_request' }, 400)
    await getDb(c.env).insert(schema.ignoredRepos).values({ owner: body.owner, repo: body.name, createdAt: Date.now() }).onConflictDoNothing()
    return c.json({ ok: true })
  })
  .post('/unignore-repo', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const body = (await c.req.json().catch(() => ({}))) as { owner?: string; name?: string }
    if (!body.owner || !body.name) return c.json({ error: 'bad_request' }, 400)
    await getDb(c.env).delete(schema.ignoredRepos).where(and(eq(schema.ignoredRepos.owner, body.owner), eq(schema.ignoredRepos.repo, body.name)))
    return c.json({ ok: true })
  })
  // Hide / show every mirrored repo at once (the onboarding master toggle).
  .post('/ignore-all', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const body = (await c.req.json().catch(() => ({}))) as { ignored?: boolean }
    const db = getDb(c.env)
    if (body.ignored) {
      const repos = await db.select().from(schema.repos).where(eq(schema.repos.userId, user.login))
      if (repos.length) {
        const now = Date.now()
        await db.insert(schema.ignoredRepos).values(repos.map((r) => ({ owner: r.owner, repo: r.name, createdAt: now }))).onConflictDoNothing()
      }
    } else {
      await db.delete(schema.ignoredRepos)
    }
    return c.json({ ok: true })
  })
  .get('/:id/linear-projects', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const db = getDb(c.env)
    const rows = await db.select().from(schema.workspaceLinearProjects).where(eq(schema.workspaceLinearProjects.workspaceId, c.req.param('id')))
    return c.json({ projectIds: rows.map((r) => r.linearProjectId) })
  })
  .put('/:id/linear-projects', async (c) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { projectIds?: string[] }
    const projectIds = (body.projectIds ?? []).filter((p) => typeof p === 'string' && p)
    const db = getDb(c.env)
    const now = Date.now()
    // Replace the set: drop removed, insert added.
    if (projectIds.length) {
      await db.delete(schema.workspaceLinearProjects).where(and(eq(schema.workspaceLinearProjects.workspaceId, id), notInArray(schema.workspaceLinearProjects.linearProjectId, projectIds)))
      await db
        .insert(schema.workspaceLinearProjects)
        .values(projectIds.map((p) => ({ workspaceId: id, linearProjectId: p, createdAt: now })))
        .onConflictDoNothing()
    } else {
      await db.delete(schema.workspaceLinearProjects).where(eq(schema.workspaceLinearProjects.workspaceId, id))
    }
    return c.json({ ok: true })
  })
