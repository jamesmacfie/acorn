// Routes for the API panel, mounted at /v2/p/http by this plugin's init (node/index.ts). Every route
// here requires a device principal (docs/http-client.md § Sending), because outbound requests and
// secret resolution must not be reachable through an internal token.
//
// A factory over the plugin's own database, not a module-scope router reading a handle off `c.env`
// (docs/data-layer.md § Plugin databases).
//
// http ships as a loaded plugin, so these routes run behind `portableCarrier`. A loaded bundle sits
// outside the host's Hono stack, so the identity comes off the request context rather than
// `owner(c)` or `c.get('principal')`.
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
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
import type { CommandInputResult } from '@acorn/protocol/commands.ts'
import { httpRequests, httpVariables } from '../../node/schema'
import { bodyModes, fromCurl, httpMethods, variableKinds, type AuthConfig, type BodyMode, type HttpMethod, type HttpRequest, type HttpVariable, type KeyValue } from '../../shared/model'
import { SendError, send, type SendCoreServices } from '../send'
import { HttpStorageError, openHttpValue, protectHttpValue } from '../storage'
import { MAX_CONTEXT_REQUESTS, requestOption, requestSnapshot } from '../agentContext'
import { importedRequestName, savedRequestSearchItems } from '../paletteSearch'

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
// whose worktree should resolve builtins and commands (docs/http-client.md § Data model).
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

// Secret values never leave the server. The client gets '' and shows a "set" placeholder; saving
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

// The command palette's input body. `input` is the pasted cURL command and `taskId` is the scope the
// HOST derived from the session it captured — neither the manifest nor a previous answer writes it
// (client-core/host/chrome/chromeCommands.ts § commandRouteScope). Bounded here because a palette field
// has no length of its own and a pasted file must not become a parse.
const paletteImportBody = z.object({
  input: z.string().trim().min(1).max(100_000),
  taskId: z.string().min(1),
})

// The palette's view of the same set, selected down to the four columns the node did NOT encrypt.
//
// A projection rather than a filter after the fact: the URL, the headers, the body, the auth block and
// the variables are the five encrypted columns, and this query does not ask for any of them, so the
// search path never holds a plaintext secret to leak (../paletteSearch.ts).
const savedRequestSummaries = async (db: PluginDatabase, userId: string, projectId: string) =>
  db
    .select({
      id: httpRequests.id,
      name: httpRequests.name,
      folder: httpRequests.folder,
      method: httpRequests.method,
    })
    .from(httpRequests)
    .where(and(inProject(userId, projectId), isNull(httpRequests.taskId)))
    .orderBy(asc(httpRequests.folder), asc(httpRequests.name))
    .limit(MAX_CONTEXT_REQUESTS)

// This project's saved tree: the rows with no task, which is what the rail lists.
const projectRequests = async (db: PluginDatabase, userId: string, projectId: string) =>
  db
    .select()
    .from(httpRequests)
    .where(and(inProject(userId, projectId), isNull(httpRequests.taskId)))
    .orderBy(asc(httpRequests.folder), asc(httpRequests.name))
    .limit(MAX_CONTEXT_REQUESTS)

// A task's own ad-hoc requests, opened. Returns null when the task is gone, and a thunk rather than
// the rows because the two callers differ in whether they need the plaintext at all: opening
// ciphertext is the expensive, credential-touching half.
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

type Emit = (frame: { channel: string } & Record<string, unknown>) => void
const savedRequestsChanged = (emit: Emit, projectId: string) => emit({ channel: pluginChannel('http', 'saved-requests-changed'), projectId })

export const httpRoutes = (db: PluginDatabase, core: SendCoreServices, emit: Emit = () => {}) => {
  const secrets = core.secrets
  return new Hono<AppEnv>()
    // Device-only gate (docs/http-client.md § Sending): this pane can resolve stored credentials and
    // make arbitrary outbound requests, so an internal token must never reach it.
    .use('*', async (c, next) => {
      if (requestContext(c).principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
      await next()
    })

    // ── Host-drawn chrome (the manifest's `sources` and `agentContexts` descriptors) ──
    //
    // The host draws these three, not this plugin's frame. A descriptor's data has to come from a
    // route, because the node is always running and a frame is not.

    // The rail's list of this project's saved requests (docs/http-client.md § Client, "the rail
    // source"). `?project=` is minted by the host from the shell's routed project
    // (client-core/host/chrome/chromeData.ts § scopedSourceItemsPath).
    //
    // No `task` block on a row, and that absence is the contribution: it tells the host there is
    // nothing to promote, so no task-creation affordance is drawn.
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

    // ── The command palette's rows (docs/plugins.md § Command kinds) ──

    // The `Find a saved request` command's rows, over the same set the rail lists.
    //
    // `projectId` is the project the palette session captured, sent by the host; a manifest names the
    // scope and never the value. The rows are filtered in SQL by owner AND project, exactly as every
    // other read in this file is (`inProject`), so an unmapped project or another login's rows are not
    // narrowed out after the fact — they are never selected.
    //
    // What comes back cannot carry a secret, and not because it was scrubbed: the query above asks for
    // four plaintext columns and none of the five the node encrypted (../paletteSearch.ts).
    .get('/palette/requests', async (c) => {
      const projectId = c.req.query('projectId')
      // No routed project is an empty list rather than an error: the command is project-scoped, so the
      // host only offers it with one, and losing a race is not worth a red line.
      if (!projectId) return c.json({ items: [] })
      const project = await core.projects.byId(projectId)
      if (!project) return c.json({ items: [] })
      const rows = await savedRequestSummaries(db, owner(c), project.id)
      return c.json({ items: savedRequestSearchItems(rows, c.req.query('q') ?? '') })
    })

    // The `Import a curl command` input: paste a command line, get a saved request.
    //
    // NOTHING IS SENT. The parser is ../../shared/model.ts's `fromCurl`, which reads flags out of a
    // token list and never executes anything, over `tokenizeShell`, which is a quote-and-escape reader
    // and not a shell — no `child_process`, no `bash -lc`, no `fetch`. The only outbound request this
    // plugin makes is `/send`, and nothing here reaches it. Sending remains a separate act the reader
    // takes in the pane, with the request in front of them.
    //
    // Task-scoped, unlike the search above, and for one reason: an input's `onSuccess` is the
    // context-free verb set, whose only way to show the reader what was created is `openPane` — and a
    // pane belongs to a task. So the import lands where a new request in a task lands anyway: on the
    // task, ad-hoc, until the reader files it (../../tree/draft.ts § emptyDraft).
    //
    // The parsed command goes through `requestBody`, the same schema the pane's own save posts through,
    // so an import can never store what a save could not, and then through `protectedRequestFields`,
    // the same encryption. The row is answered only after the insert resolves.
    .post('/palette/import-curl', async (c) => {
      const parsed = paletteImportBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
      const task = await core.tasks.load(parsed.data.taskId)
      if (!task?.projectId) return respondError(c, 404, 'not_found')
      const project = await core.projects.byId(task.projectId)
      if (!project) return respondError(c, 404, 'not_found')
      const curl = fromCurl(parsed.data.input)
      // `null` is "that is not a curl command with a URL in it", which is the reader's typo rather than
      // a fault. The palette keeps their text and shows this line under it.
      if (!curl) return respondError(c, 400, 'bad_request', ['That is not a curl command with a URL in it.'])
      const method = (httpMethods as readonly string[]).includes(curl.method) ? curl.method as HttpMethod : 'GET'
      const draft = requestBody.safeParse({
        folder: '',
        taskId: parsed.data.taskId,
        name: importedRequestName(method, curl.url),
        method,
        url: curl.url,
        headers: curl.headers,
        bodyMode: curl.bodyMode,
        body: curl.body,
        auth: curl.auth,
        vars: {},
      })
      if (!draft.success) return respondError(c, 400, 'bad_request', draft.error.issues.map((i) => i.message))
      const protectedFields = await protectedRequestFields(draft.data, secrets)
      const row = {
        id: crypto.randomUUID(),
        userId: owner(c),
        projectId: project.id,
        folder: draft.data.folder,
        taskId: draft.data.taskId,
        name: draft.data.name,
        method: draft.data.method,
        url: protectedFields.url,
        headers: protectedFields.headers,
        bodyMode: draft.data.bodyMode,
        body: protectedFields.body,
        auth: protectedFields.auth,
        vars: protectedFields.vars,
        encrypted: true,
        createdAt: now(),
        updatedAt: now(),
      }
      await db.insert(httpRequests).values(row)
      savedRequestsChanged(emit, project.id)
      // Answered after the write, and with the same summary a search row carries: an id, a name and a
      // method, and none of what was just encrypted. The success action opens the pane, which reads
      // this id off the row and selects it (../../tree/panelModel.ts).
      return c.json({
        ok: true,
        item: { id: row.id, title: row.name, badge: row.method },
      } satisfies CommandInputResult)
    })

    // The agent composer's option list and capture, for the task the composer named
    // (docs/http-client.md § Client). Both resolve the project from the task rather than taking one
    // from the caller: a project parameter here would be a second thing to check ownership of.
    //
    // The set is this task's ad-hoc requests, so a task with no ad-hoc requests offers nothing.
    // Widening it to the project tree is a product decision.
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
      savedRequestsChanged(emit, project.id)
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
      savedRequestsChanged(emit, project.id)
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
      savedRequestsChanged(emit, project.id)
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

      // The client never sees a secret's plaintext, so it sends '' to mean "leave it alone".
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

// The Hono routes over the portable carrier, the only way in. The bundle keeps its own Hono
// (build-plugin.mjs inlines every non-builtin dependency), so a router instance can never cross the
// contract. Only `router.fetch` does.
export const createHttpFetch = (db: PluginDatabase, core: SendCoreServices, emit?: Emit): PluginFetchHandler =>
  portableFetch(httpRoutes(db, core, emit))
