// Routes for the API panel, mounted at /api/http (app/server/routes.ts). The core stack applies
// csrf → authMiddleware → requireUser; this router adds an interactive-principal gate because its
// outbound-request and secret-resolution powers must not be reachable through the internal token.
import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@acorn/node-core/server/db/index.ts'
import * as schema from '@acorn/node-core/server/db/schema.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { getUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { bodyModes, httpMethods, variableKinds, type AuthConfig, type BodyMode, type HttpRequest, type HttpVariable, type KeyValue } from '../../shared/model'
import { SendError, send } from '../send'
import { HttpStorageError, openHttpValue, protectHttpValue } from '../storage'

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

// Sending is not a persistence operation: accept only wire-relevant request fields plus the task
// whose worktree should resolve builtins/commands. In particular, the stored row's filing taskId
// must not double as execution context.
const sendBody = z.object({
  method: z.enum(httpMethods),
  url: z.string().max(4000),
  headers: z.array(keyValue).max(100).default([]),
  bodyMode: z.enum(bodyModes).default('none'),
  body: z.string().max(1_000_000).default(''),
  auth: authSchema.default({ mode: 'none' }),
  vars: z.record(z.string(), z.string()).default({}),
  executionTaskId: z.string().nullable().default(null),
})

const now = () => Date.now()
const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const toRequest = async (row: typeof schema.httpRequests.$inferSelect, encryptionKey: string): Promise<HttpRequest> => {
  const [url, headers, body, auth, vars] = await Promise.all([
    openHttpValue(row.url, row.encrypted, encryptionKey),
    openHttpValue(row.headers, row.encrypted, encryptionKey),
    openHttpValue(row.body, row.encrypted, encryptionKey),
    openHttpValue(row.auth, row.encrypted, encryptionKey),
    openHttpValue(row.vars, row.encrypted, encryptionKey),
  ])
  return {
    id: row.id,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    folder: row.folder,
    taskId: row.taskId,
    name: row.name,
    method: row.method,
    url,
    headers: parseJson<KeyValue[]>(headers, []),
    bodyMode: row.bodyMode as BodyMode,
    body,
    auth: parseJson<AuthConfig>(auth, { mode: 'none' }),
    vars: parseJson<Record<string, string>>(vars, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// Secret values never leave the server. The renderer gets '' and shows a "set" placeholder; saving
// an unchanged secret means sending '' back, which the PUT handler treats as "keep what's stored".
const toVariable = async (row: typeof schema.httpVariables.$inferSelect, encryptionKey: string): Promise<HttpVariable> => ({
  id: row.id,
  name: row.name,
  kind: row.kind as HttpVariable['kind'],
  value: row.kind === 'secret' ? '' : await openHttpValue(row.value, row.encrypted, encryptionKey),
  enabled: row.enabled,
  updatedAt: row.updatedAt,
})

const scope = (c: { req: { param: (k: string) => string } }) => ({ owner: c.req.param('owner'), repo: c.req.param('repo') })
const inRepo = (userId: string, owner: string, repo: string) =>
  and(eq(schema.httpRequests.userId, userId), eq(schema.httpRequests.repoOwner, owner), eq(schema.httpRequests.repoName, repo))
const variablesInRepo = (userId: string, owner: string, repo: string) =>
  and(eq(schema.httpVariables.userId, userId), eq(schema.httpVariables.repoOwner, owner), eq(schema.httpVariables.repoName, repo))

const protectedRequestFields = async (d: z.infer<typeof requestBody>, encryptionKey: string) => {
  const [url, headers, body, auth, vars] = await Promise.all([
    protectHttpValue(d.url, encryptionKey),
    protectHttpValue(JSON.stringify(d.headers), encryptionKey),
    protectHttpValue(d.body, encryptionKey),
    protectHttpValue(JSON.stringify(d.auth), encryptionKey),
    protectHttpValue(JSON.stringify(d.vars), encryptionKey),
  ])
  return { url, headers, body, auth, vars }
}

export const http = new Hono<AppEnv>()
  // This pane can resolve stored credentials and make arbitrary outbound requests. The internal
  // token is deliberately insufficient: agent/MCP child processes must never use it as a secret
  // decryption oracle.
  .use('*', async (c, next) => {
    if (c.get('principal')?.kind !== 'user') return respondError(c, 403, 'interactive_user_required')
    await next()
  })

  // Saved requests for the repo. `?taskId=` returns that task's ad-hoc requests instead of the
  // repo tree; the two sets are disjoint by construction (taskId null vs set).
  .get('/:owner/:repo/requests', async (c) => {
    const { owner, repo } = scope(c)
    const userId = getUser(c).login
    const taskId = c.req.query('taskId')
    const rows = await getDb(c.env)
      .select()
      .from(schema.httpRequests)
      .where(and(inRepo(userId, owner, repo), taskId ? eq(schema.httpRequests.taskId, taskId) : isNull(schema.httpRequests.taskId)))
      .orderBy(asc(schema.httpRequests.folder), asc(schema.httpRequests.name))
    return c.json(await Promise.all(rows.map((row) => toRequest(row, c.env.SESSION_ENC_KEY))))
  })

  .post('/:owner/:repo/requests', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = requestBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const protectedFields = await protectedRequestFields(d, c.env.SESSION_ENC_KEY)
    const row = {
      id: crypto.randomUUID(),
      userId: getUser(c).login,
      repoOwner: owner,
      repoName: repo,
      folder: d.folder,
      taskId: d.taskId,
      name: d.name,
      method: d.method,
      url: protectedFields.url,
      headers: protectedFields.headers,
      bodyMode: d.bodyMode,
      body: protectedFields.body,
      auth: protectedFields.auth,
      vars: protectedFields.vars,
      encrypted: true,
      createdAt: now(),
      updatedAt: now(),
    }
    await getDb(c.env).insert(schema.httpRequests).values(row)
    return c.json(await toRequest(row, c.env.SESSION_ENC_KEY), 201)
  })

  .put('/:owner/:repo/requests/:id', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = requestBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const db = getDb(c.env)
    const userId = getUser(c).login
    const protectedFields = await protectedRequestFields(d, c.env.SESSION_ENC_KEY)
    // Scope the update to this repo so an id from another repo can't be smuggled in.
    const updated = await db
      .update(schema.httpRequests)
      .set({
        folder: d.folder,
        taskId: d.taskId,
        name: d.name,
        method: d.method,
        url: protectedFields.url,
        headers: protectedFields.headers,
        bodyMode: d.bodyMode,
        body: protectedFields.body,
        auth: protectedFields.auth,
        vars: protectedFields.vars,
        encrypted: true,
        updatedAt: now(),
      })
      .where(and(inRepo(userId, owner, repo), eq(schema.httpRequests.id, c.req.param('id'))))
      .returning()
    if (!updated.length) return respondError(c, 404, 'not_found')
    return c.json(await toRequest(updated[0], c.env.SESSION_ENC_KEY))
  })

  .delete('/:owner/:repo/requests/:id', async (c) => {
    const { owner, repo } = scope(c)
    const userId = getUser(c).login
    const deleted = await getDb(c.env)
      .delete(schema.httpRequests)
      .where(and(inRepo(userId, owner, repo), eq(schema.httpRequests.id, c.req.param('id'))))
      .returning({ id: schema.httpRequests.id })
    if (!deleted.length) return respondError(c, 404, 'not_found')
    return c.body(null, 204)
  })

  // --- repo variables ---

  .get('/:owner/:repo/vars', async (c) => {
    const { owner, repo } = scope(c)
    const userId = getUser(c).login
    const rows = await getDb(c.env)
      .select()
      .from(schema.httpVariables)
      .where(variablesInRepo(userId, owner, repo))
      .orderBy(asc(schema.httpVariables.name))
    return c.json(await Promise.all(rows.map((row) => toVariable(row, c.env.SESSION_ENC_KEY))))
  })

  .post('/:owner/:repo/vars', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = variableBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const userId = getUser(c).login
    const value = await protectHttpValue(d.value, c.env.SESSION_ENC_KEY)
    const row = {
      id: crypto.randomUUID(),
      userId,
      repoOwner: owner,
      repoName: repo,
      name: d.name,
      kind: d.kind,
      value,
      encrypted: true,
      enabled: d.enabled,
      createdAt: now(),
      updatedAt: now(),
    }
    try {
      await getDb(c.env).insert(schema.httpVariables).values(row)
    } catch {
      return respondError(c, 409, 'duplicate_name', [`A variable named "${d.name}" already exists for this repo`])
    }
    return c.json(await toVariable(row, c.env.SESSION_ENC_KEY), 201)
  })

  .put('/:owner/:repo/vars/:id', async (c) => {
    const { owner, repo } = scope(c)
    const parsed = variableBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    const d = parsed.data
    const db = getDb(c.env)
    const userId = getUser(c).login
    const id = c.req.param('id')
    const existing = await db
      .select()
      .from(schema.httpVariables)
      .where(and(variablesInRepo(userId, owner, repo), eq(schema.httpVariables.id, id)))
    if (!existing.length) return respondError(c, 404, 'not_found')

    // The renderer never sees a secret's plaintext, so it sends '' to mean "leave it alone".
    const unchangedSecret = d.kind === 'secret' && existing[0].kind === 'secret' && d.value === ''
    const value = unchangedSecret ? existing[0].value : await protectHttpValue(d.value, c.env.SESSION_ENC_KEY)

    const updated = await db
      .update(schema.httpVariables)
      .set({ name: d.name, kind: d.kind, value, encrypted: true, enabled: d.enabled, updatedAt: now() })
      .where(and(variablesInRepo(userId, owner, repo), eq(schema.httpVariables.id, id)))
      .returning()
    return c.json(await toVariable(updated[0], c.env.SESSION_ENC_KEY))
  })

  .delete('/:owner/:repo/vars/:id', async (c) => {
    const { owner, repo } = scope(c)
    const userId = getUser(c).login
    const deleted = await getDb(c.env)
      .delete(schema.httpVariables)
      .where(and(variablesInRepo(userId, owner, repo), eq(schema.httpVariables.id, c.req.param('id'))))
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
      return c.json(await send(getDb(c.env), getUser(c).login, owner, repo, c.env.SESSION_ENC_KEY, parsed.data))
    } catch (err) {
      // Preparation failures (invalid resolved URL, command/secret resolution) have no attempted
      // request to display, so they stay a 422. Network attempts return a typed SendFailure above.
      if (err instanceof SendError) return respondError(c, 422, 'send_failed', [err.message])
      if (err instanceof HttpStorageError) return respondError(c, 422, 'send_failed', ['Saved HTTP data could not be opened'])
      throw err
    }
  })
