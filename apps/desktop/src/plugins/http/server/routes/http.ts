// Routes for the API panel, mounted at /api/http (app/server/routes.ts). Everything under /api is
// already behind csrf → authMiddleware → requireUser (core/server/index.ts), so there is no guard
// here. Repo-scoped like the Database pane's saved queries.
import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../../../core/server/db'
import * as schema from '../../../../core/server/db/schema'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { respondError } from '../../../../core/server/respond'
import { encryptSecret } from '../../../../core/server/session'
import { bodyModes, httpMethods, variableKinds, type AuthConfig, type BodyMode, type HttpRequest, type HttpVariable, type KeyValue } from '../../shared/model'
import { SendError, send } from '../send'

const keyValue = z.object({ name: z.string(), value: z.string(), enabled: z.boolean() })

const authSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ mode: z.literal('bearer'), token: z.string() }),
  z.object({ mode: z.literal('apikey'), key: z.string(), value: z.string(), placement: z.enum(['header', 'query']) }),
])

const requestBody = z.object({
  folder: z.string().max(500).default(''),
  taskId: z.string().nullable().default(null),
  name: z.string().min(1).max(200),
  method: z.enum(httpMethods),
  url: z.string().max(4000),
  headers: z.array(keyValue).max(100).default([]),
  bodyMode: z.enum(bodyModes).default('none'),
  body: z.string().max(1_000_000).default(''),
  auth: authSchema.default({ mode: 'none' }),
  vars: z.record(z.string(), z.string()).default({}),
})

const variableBody = z.object({
  name: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/, 'letters, digits, dot, dash and underscore only'),
  kind: z.enum(variableKinds),
  value: z.string().max(10_000),
  enabled: z.boolean().default(true),
})

const sendBody = requestBody.partial({ name: true, folder: true }).extend({ name: z.string().default('') })

const now = () => Date.now()
const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const toRequest = (row: typeof schema.httpRequests.$inferSelect): HttpRequest => ({
  id: row.id,
  repoOwner: row.repoOwner,
  repoName: row.repoName,
  folder: row.folder,
  taskId: row.taskId,
  name: row.name,
  method: row.method,
  url: row.url,
  headers: parseJson<KeyValue[]>(row.headers, []),
  bodyMode: row.bodyMode as BodyMode,
  body: row.body,
  auth: parseJson<AuthConfig>(row.auth, { mode: 'none' }),
  vars: parseJson<Record<string, string>>(row.vars, {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

// Secret values never leave the server. The renderer gets '' and shows a "set" placeholder; saving
// an unchanged secret means sending '' back, which the PUT handler treats as "keep what's stored".
const toVariable = (row: typeof schema.httpVariables.$inferSelect): HttpVariable => ({
  id: row.id,
  name: row.name,
  kind: row.kind as HttpVariable['kind'],
  value: row.kind === 'secret' ? '' : row.value,
  enabled: row.enabled,
  updatedAt: row.updatedAt,
})

const scope = (c: { req: { param: (k: string) => string } }) => ({ owner: c.req.param('owner'), repo: c.req.param('repo') })
const inRepo = (owner: string, repo: string) => and(eq(schema.httpRequests.repoOwner, owner), eq(schema.httpRequests.repoName, repo))

export const http = new Hono<AppEnv>()

  // Saved requests for the repo. `?taskId=` returns that task's ad-hoc requests instead of the
  // repo tree; the two sets are disjoint by construction (taskId null vs set).
  .get('/:owner/:repo/requests', async (c) => {
    const { owner, repo } = scope(c)
    const taskId = c.req.query('taskId')
    const rows = await getDb(c.env)
      .select()
      .from(schema.httpRequests)
      .where(and(inRepo(owner, repo), taskId ? eq(schema.httpRequests.taskId, taskId) : isNull(schema.httpRequests.taskId)))
      .orderBy(asc(schema.httpRequests.folder), asc(schema.httpRequests.name))
    return c.json(rows.map(toRequest))
  })

  .post('/:owner/:repo/requests', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = requestBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const row = {
      id: crypto.randomUUID(),
      repoOwner: owner,
      repoName: repo,
      folder: d.folder,
      taskId: d.taskId,
      name: d.name,
      method: d.method,
      url: d.url,
      headers: JSON.stringify(d.headers),
      bodyMode: d.bodyMode,
      body: d.body,
      auth: JSON.stringify(d.auth),
      vars: JSON.stringify(d.vars),
      createdAt: now(),
      updatedAt: now(),
    }
    await getDb(c.env).insert(schema.httpRequests).values(row)
    return c.json(toRequest(row), 201)
  })

  .put('/:owner/:repo/requests/:id', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = requestBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const db = getDb(c.env)
    // Scope the update to this repo so an id from another repo can't be smuggled in.
    const updated = await db
      .update(schema.httpRequests)
      .set({
        folder: d.folder,
        taskId: d.taskId,
        name: d.name,
        method: d.method,
        url: d.url,
        headers: JSON.stringify(d.headers),
        bodyMode: d.bodyMode,
        body: d.body,
        auth: JSON.stringify(d.auth),
        vars: JSON.stringify(d.vars),
        updatedAt: now(),
      })
      .where(and(inRepo(owner, repo), eq(schema.httpRequests.id, c.req.param('id'))))
      .returning()
    if (!updated.length) return respondError(c, 404, 'not_found')
    return c.json(toRequest(updated[0]))
  })

  .delete('/:owner/:repo/requests/:id', async (c) => {
    const { owner, repo } = scope(c)
    const deleted = await getDb(c.env)
      .delete(schema.httpRequests)
      .where(and(inRepo(owner, repo), eq(schema.httpRequests.id, c.req.param('id'))))
      .returning({ id: schema.httpRequests.id })
    if (!deleted.length) return respondError(c, 404, 'not_found')
    return c.body(null, 204)
  })

  // --- repo variables ---

  .get('/:owner/:repo/vars', async (c) => {
    const { owner, repo } = scope(c)
    const rows = await getDb(c.env)
      .select()
      .from(schema.httpVariables)
      .where(and(eq(schema.httpVariables.repoOwner, owner), eq(schema.httpVariables.repoName, repo)))
      .orderBy(asc(schema.httpVariables.name))
    return c.json(rows.map(toVariable))
  })

  .post('/:owner/:repo/vars', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = variableBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const value = await storedValue(c.env.SESSION_ENC_KEY, d.kind, d.value)
    if (value === null) return respondError(c, 503, 'no_session_key', ['Cannot store a secret without a session key'])
    const row = { id: crypto.randomUUID(), repoOwner: owner, repoName: repo, name: d.name, kind: d.kind, value, enabled: d.enabled, createdAt: now(), updatedAt: now() }
    try {
      await getDb(c.env).insert(schema.httpVariables).values(row)
    } catch {
      return respondError(c, 409, 'duplicate_name', [`A variable named "${d.name}" already exists for this repo`])
    }
    return c.json(toVariable(row), 201)
  })

  .put('/:owner/:repo/vars/:id', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = variableBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const db = getDb(c.env)
    const id = c.req.param('id')
    const existing = await db
      .select()
      .from(schema.httpVariables)
      .where(and(eq(schema.httpVariables.repoOwner, owner), eq(schema.httpVariables.repoName, repo), eq(schema.httpVariables.id, id)))
    if (!existing.length) return respondError(c, 404, 'not_found')

    // The renderer never sees a secret's plaintext, so it sends '' to mean "leave it alone".
    const unchangedSecret = d.kind === 'secret' && existing[0].kind === 'secret' && d.value === ''
    const value = unchangedSecret ? existing[0].value : await storedValue(c.env.SESSION_ENC_KEY, d.kind, d.value)
    if (value === null) return respondError(c, 503, 'no_session_key', ['Cannot store a secret without a session key'])

    const updated = await db
      .update(schema.httpVariables)
      .set({ name: d.name, kind: d.kind, value, enabled: d.enabled, updatedAt: now() })
      .where(and(eq(schema.httpVariables.repoOwner, owner), eq(schema.httpVariables.repoName, repo), eq(schema.httpVariables.id, id)))
      .returning()
    return c.json(toVariable(updated[0]))
  })

  .delete('/:owner/:repo/vars/:id', async (c) => {
    const { owner, repo } = scope(c)
    const deleted = await getDb(c.env)
      .delete(schema.httpVariables)
      .where(and(eq(schema.httpVariables.repoOwner, owner), eq(schema.httpVariables.repoName, repo), eq(schema.httpVariables.id, c.req.param('id'))))
      .returning({ id: schema.httpVariables.id })
    if (!deleted.length) return respondError(c, 404, 'not_found')
    return c.body(null, 204)
  })

  // --- send ---
  // The request is sent inline rather than by id, so an unsaved edit (and an ad-hoc request that
  // was never saved at all) can be fired without a round-trip through the DB first.
  .post('/:owner/:repo/send', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = sendBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    try {
      return c.json(await send(getDb(c.env), owner, repo, c.env.SESSION_ENC_KEY, parsed.data))
    } catch (err) {
      // A failed request is a normal outcome here, not a server fault — report it as a 422 with the
      // reason so the pane can show it in place of a response.
      if (err instanceof SendError) return respondError(c, 422, 'send_failed', [err.message])
      throw err
    }
  })

// Returns null when a secret is asked for but no key is available.
async function storedValue(encKey: string | undefined, kind: string, value: string): Promise<string | null> {
  if (kind !== 'secret') return value
  if (!encKey) return null
  return encryptSecret(value, encKey)
}
