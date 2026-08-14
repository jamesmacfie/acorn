// Routes for the API panel, mounted at /v2/p/http by this plugin's init (node/index.ts). The core stack
// applies authMiddleware → requireUser; this router adds an interactive-principal gate because its
// outbound-request and secret-resolution powers must not be reachable through the internal token.
//
// A FACTORY over the plugin's own database, not a module-scope router reading db: the tables
// live in <data-root>/plugins/http.sqlite now, and c.env deliberately does not carry per-plugin handles
// (docs/data-layer.md § Plugin DBs). The SecretService comes from CoreServices for the same reason — this
// router no longer needs `c.env` at all, which is the point.
//
// http ships LOADED, so these routes run on one tier: the host gets `router.fetch` (createHttpFetch at
// the bottom) and the identity-bound runtime rides in through `c.env` behind `portableCarrier` —
// literally the same carrier rollbar and linear use. That is also why the identity below comes off the request context
// rather than out of `owner(c)`/`c.get('principal')`: a loaded bundle is not inside the host's Hono
// stack, so those middleware-set values are simply not there.
import { Hono, type Context } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  type AppEnv,
  type PluginDatabase,
  type PluginFetchHandler,
  portableCarrier,
  respondError,
  type SecretService,
} from '@acorn/plugin-api/node'
import type { PluginRailItems } from '@acorn/protocol/api.ts'
import { httpRequests, httpVariables } from '../../node/schema'
import { bodyModes, httpMethods, variableKinds, type AuthConfig, type BodyMode, type HttpRequest, type HttpVariable, type KeyValue } from '../../shared/model'
import { SendError, send, type SendCoreServices } from '../send'
import { HttpStorageError, openHttpValue, protectHttpValue } from '../storage'
import { MAX_CONTEXT_REQUESTS, requestOption, requestSnapshot } from '../agentContext'

// The carrier is the host's (@acorn/plugin-api/node); a request arriving without the context is a
// wiring bug, and saying so beats answering it from host handles this bundle should no longer touch.
const { requestContext, portableFetch } = portableCarrier('http')

const owner = (c: Context<AppEnv>): string => requestContext(c).userId

const keyValue = z.object({ name: z.string(), value: z.string(), enabled: z.boolean() })

const authSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ mode: z.literal('bearer'), token: z.string() }),
  z.object({ mode: z.literal('apikey'), key: z.string(), value: z.string(), placement: z.enum(['header', 'query']) }),
])

const requestBody = z.object({
  folder: z.string().max(500).default(''),
  taskId: z.string().min(1).nullable().default(null),
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

const toRequest = async (row: typeof httpRequests.$inferSelect, secrets: SecretService, projectId: string): Promise<HttpRequest> => {
  const [url, headers, body, auth, vars] = await Promise.all([
    openHttpValue(row.url, row.encrypted, secrets),
    openHttpValue(row.headers, row.encrypted, secrets),
    openHttpValue(row.body, row.encrypted, secrets),
    openHttpValue(row.auth, row.encrypted, secrets),
    openHttpValue(row.vars, row.encrypted, secrets),
  ])
  return {
    id: row.id,
    projectId,
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
const toVariable = async (row: typeof httpVariables.$inferSelect, secrets: SecretService): Promise<HttpVariable> => ({
  id: row.id,
  name: row.name,
  kind: row.kind as HttpVariable['kind'],
  value: row.kind === 'secret' ? '' : await openHttpValue(row.value, row.encrypted, secrets),
  enabled: row.enabled,
  updatedAt: row.updatedAt,
})

const projectScope = async (c: { req: { param: (key: string) => string } }, core: SendCoreServices) => {
  const project = await core.projects.byId(c.req.param('projectId'))
  return project ? { project } : null
}
const taskScopeError = (taskId: string) => `Task "${taskId}" does not belong to this project`
const taskBelongsToProject = async (taskId: string, projectId: string, core: SendCoreServices): Promise<boolean> =>
  (await core.tasks.load(taskId))?.projectId === projectId
const inProject = (userId: string, projectId: string) => and(eq(httpRequests.userId, userId), eq(httpRequests.projectId, projectId))
const variablesInProject = (userId: string, projectId: string) => and(eq(httpVariables.userId, userId), eq(httpVariables.projectId, projectId))

// The composer's POST body. `taskId` is the scope the host minted; `workspaceId` may ride along and is
// ignored here, because a saved request belongs to a project and the task already names one.
const contextCaptureBody = z.object({
  taskId: z.string().min(1),
  optionIds: z.array(z.string().min(1)).max(MAX_CONTEXT_REQUESTS).optional(),
})

// This project's saved tree — the rows with no task, which is what the rail lists.
const projectRequests = async (db: PluginDatabase, userId: string, projectId: string) =>
  db
    .select()
    .from(httpRequests)
    .where(and(inProject(userId, projectId), isNull(httpRequests.taskId)))
    .orderBy(asc(httpRequests.folder), asc(httpRequests.name))
    .limit(MAX_CONTEXT_REQUESTS)

// A task's own ad-hoc requests, opened. Returns null when the task is gone, and a THUNK rather than the
// rows because the two callers differ in whether they need the plaintext at all — and opening ciphertext
// is the expensive, credential-touching half.
const taskRequests = async (
  c: Context<AppEnv>,
  db: PluginDatabase,
  core: SendCoreServices,
  fromBody?: string,
): Promise<(() => Promise<HttpRequest[]>) | null> => {
  const taskId = fromBody ?? c.req.query('taskId')
  if (!taskId) return null
  const task = await core.tasks.load(taskId)
  if (!task?.projectId) return null
  const projectId = task.projectId
  const userId = owner(c)
  return async () => {
    const rows = await db
      .select()
      .from(httpRequests)
      .where(and(inProject(userId, projectId), eq(httpRequests.taskId, taskId)))
      .orderBy(asc(httpRequests.folder), asc(httpRequests.name))
      .limit(MAX_CONTEXT_REQUESTS)
    return Promise.all(rows.map((row) => toRequest(row, core.secrets, projectId)))
  }
}

const protectedRequestFields = async (d: z.infer<typeof requestBody>, secrets: SecretService) => {
  const [url, headers, body, auth, vars] = await Promise.all([
    protectHttpValue(d.url, secrets),
    protectHttpValue(JSON.stringify(d.headers), secrets),
    protectHttpValue(d.body, secrets),
    protectHttpValue(JSON.stringify(d.auth), secrets),
    protectHttpValue(JSON.stringify(d.vars), secrets),
  ])
  return { url, headers, body, auth, vars }
}

export const httpRoutes = (db: PluginDatabase, core: SendCoreServices) => {
  const secrets = core.secrets
  return new Hono<AppEnv>()
    // This pane can resolve stored credentials and make arbitrary outbound requests. The internal
    // token is deliberately insufficient: agent/MCP child processes must never use it as a secret
    // decryption oracle.
    .use('*', async (c, next) => {
      // 'device' is the owner principal allowed to drive this pane. An internal token must never reach it.
      if (requestContext(c).principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
      await next()
    })

    // ── Host-drawn chrome (the manifest's `sources` and `agentContexts` descriptors) ──────────────
    //
    // These three answer to the HOST rather than to this plugin's own frame: the rail draws the rows,
    // and the agent composer draws the picker. Which is why they are here at all — a descriptor's data
    // has to come from a route, because the node is always running and a frame is not.

    // The rail's list of this project's saved requests. `?project=` is minted by the host from the
    // shell's routed project (client-core/plugins/chrome/data.ts § scopedSourceItemsPath); with no
    // project routed there is nothing to list, and the descriptor's empty state says where to go.
    //
    // No `task` block on a row, and that absence is the contribution: it is what tells the host there is
    // nothing to promote here, so no `+TASK` affordance is drawn. A saved request is not an external item
    // — the compiled source carried a permanent promotion stub to say the same thing in more code.
    .get('/rail-items', async (c) => {
      const projectId = c.req.query('project')
      if (!projectId) return c.json({ items: [] } satisfies PluginRailItems)
      const project = await core.projects.byId(projectId)
      if (!project) return c.json({ items: [] } satisfies PluginRailItems)
      const rows = await projectRequests(db, owner(c), project.id)
      return c.json({
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          badge: row.method,
          icon: 'send',
          ...(row.folder ? { subtitle: row.folder } : {}),
        })),
      } satisfies PluginRailItems)
    })

    // The agent composer's option list and capture, for the task the composer named. Both resolve the
    // project from the TASK rather than taking one from the caller: the composer's scope is a task, and a
    // project parameter here would be a second thing to check ownership of.
    //
    // The set is this task's ad-hoc requests, which is exactly what the renderer contribution listed
    // before the move — deliberately unchanged, so a difference in what an agent receives cannot be
    // blamed on the tier. It is also thinner than it looks — a task with no ad-hoc requests offers
    // nothing; widening it to the project tree is a product decision, not a port.
    .get('/context-options', async (c) => {
      const scoped = await taskRequests(c, db, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      return c.json((await scoped()).map(requestOption))
    })

    .post('/context-capture', async (c) => {
      const body = await c.req.json().catch(() => null)
      const optionIds = contextCaptureBody.safeParse(body)
      if (!optionIds.success) return respondError(c, 400, 'bad_request', optionIds.error.issues.map((i) => i.message))
      const scoped = await taskRequests(c, db, core, optionIds.data.taskId)
      if (!scoped) return respondError(c, 404, 'not_found')
      const requests = await scoped()
      const chosen = optionIds.data.optionIds
        ? requests.filter((request) => optionIds.data.optionIds?.includes(request.id))
        : requests
      return c.json(chosen.map(requestSnapshot))
    })

    // Saved requests for the project. `?taskId=` returns that task's ad-hoc requests instead of the
    // project tree; the two sets are disjoint by construction (taskId null vs set).
    .get('/projects/:projectId/requests', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const userId = owner(c)
      const taskId = c.req.query('taskId')
      if (taskId === '') return respondError(c, 400, 'bad_request', ['taskId must not be empty'])
      if (taskId && !(await taskBelongsToProject(taskId, project.id, core))) return respondError(c, 400, 'bad_request', [taskScopeError(taskId)])
      const rows = await db
        .select()
        .from(httpRequests)
        .where(and(inProject(userId, project.id), taskId ? eq(httpRequests.taskId, taskId) : isNull(httpRequests.taskId)))
        .orderBy(asc(httpRequests.folder), asc(httpRequests.name))
      return c.json(await Promise.all(rows.map((row) => toRequest(row, secrets, project.id))))
    })

    .post('/projects/:projectId/requests', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const parsed = requestBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
      const d = parsed.data
      if (d.taskId && !(await taskBelongsToProject(d.taskId, project.id, core))) return respondError(c, 400, 'bad_request', [taskScopeError(d.taskId)])
      const protectedFields = await protectedRequestFields(d, secrets)
      const row = {
        id: crypto.randomUUID(),
        userId: owner(c),
        projectId: project.id,
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
      await db.insert(httpRequests).values(row)
      return c.json(await toRequest(row, secrets, project.id), 201)
    })

    .put('/projects/:projectId/requests/:id', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const parsed = requestBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
      const d = parsed.data
      if (d.taskId && !(await taskBelongsToProject(d.taskId, project.id, core))) return respondError(c, 400, 'bad_request', [taskScopeError(d.taskId)])
      const userId = owner(c)
      const protectedFields = await protectedRequestFields(d, secrets)
      // Scope the update to this project so an id from another project can't be smuggled in.
      const updated = await db
        .update(httpRequests)
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
        .where(and(inProject(userId, project.id), eq(httpRequests.id, c.req.param('id'))))
        .returning()
      if (!updated.length) return respondError(c, 404, 'not_found')
      return c.json(await toRequest(updated[0], secrets, project.id))
    })

    .delete('/projects/:projectId/requests/:id', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const userId = owner(c)
      const deleted = await db
        .delete(httpRequests)
        .where(and(inProject(userId, project.id), eq(httpRequests.id, c.req.param('id'))))
        .returning({ id: httpRequests.id })
      if (!deleted.length) return respondError(c, 404, 'not_found')
      return c.body(null, 204)
    })

    // --- project variables ---

    .get('/projects/:projectId/vars', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const userId = owner(c)
      const rows = await db
        .select()
        .from(httpVariables)
        .where(variablesInProject(userId, project.id))
        .orderBy(asc(httpVariables.name))
      return c.json(await Promise.all(rows.map((row) => toVariable(row, secrets))))
    })

    .post('/projects/:projectId/vars', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const parsed = variableBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
      const d = parsed.data
      const userId = owner(c)
      const value = await protectHttpValue(d.value, secrets)
      const row = {
        id: crypto.randomUUID(),
        userId,
        projectId: project.id,
        name: d.name,
        kind: d.kind,
        value,
        encrypted: true,
        enabled: d.enabled,
        createdAt: now(),
        updatedAt: now(),
      }
      try {
        await db.insert(httpVariables).values(row)
      } catch {
        return respondError(c, 409, 'duplicate_name', [`A variable named "${d.name}" already exists for this project`])
      }
      return c.json(await toVariable(row, secrets), 201)
    })

    .put('/projects/:projectId/vars/:id', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const parsed = variableBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
      const d = parsed.data
      const userId = owner(c)
      const id = c.req.param('id')
      const existing = await db
        .select()
        .from(httpVariables)
        .where(and(variablesInProject(userId, project.id), eq(httpVariables.id, id)))
      if (!existing.length) return respondError(c, 404, 'not_found')

      // The renderer never sees a secret's plaintext, so it sends '' to mean "leave it alone".
      const unchangedSecret = d.kind === 'secret' && existing[0].kind === 'secret' && d.value === ''
      const value = unchangedSecret ? existing[0].value : await protectHttpValue(d.value, secrets)

      const updated = await db
        .update(httpVariables)
        .set({ name: d.name, kind: d.kind, value, encrypted: true, enabled: d.enabled, updatedAt: now() })
        .where(and(variablesInProject(userId, project.id), eq(httpVariables.id, id)))
        .returning()
      return c.json(await toVariable(updated[0], secrets))
    })

    .delete('/projects/:projectId/vars/:id', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const userId = owner(c)
      const deleted = await db
        .delete(httpVariables)
        .where(and(variablesInProject(userId, project.id), eq(httpVariables.id, c.req.param('id'))))
        .returning({ id: httpVariables.id })
      if (!deleted.length) return respondError(c, 404, 'not_found')
      return c.body(null, 204)
    })

    // --- send ---
    // The request is sent inline rather than by id, so an unsaved edit (and an ad-hoc request that
    // was never saved at all) can be fired without a round-trip through the DB first.
    .post('/projects/:projectId/send', async (c) => {
      const scoped = await projectScope(c, core)
      if (!scoped) return respondError(c, 404, 'not_found')
      const { project } = scoped
      const parsed = sendBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
      try {
        return c.json(await send(db, core, owner(c), project.id, parsed.data))
      } catch (err) {
        // Preparation failures (invalid resolved URL, command/secret resolution) have no attempted
        // request to display, so they stay a 422. Network attempts return a typed SendFailure above.
        if (err instanceof SendError) return respondError(c, 422, 'send_failed', [err.message])
        if (err instanceof HttpStorageError) return respondError(c, 422, 'send_failed', ['Saved HTTP data could not be opened'])
        throw err
      }
    })
}

// The Hono routes over the portable carrier — the only way in. Its request context supplies the caller's
// identity without this bundle reaching for the host's middleware state, and the bundle keeps its OWN
// Hono (build-plugin.mjs inlines every non-builtin dependency), which is why a router instance can never
// cross the contract and `router.fetch` does.
export const createHttpFetch = (db: PluginDatabase, core: SendCoreServices): PluginFetchHandler =>
  portableFetch(httpRoutes(db, core))
