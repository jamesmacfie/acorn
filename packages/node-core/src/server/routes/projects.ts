import { Hono } from 'hono'
import { z } from 'zod'
import type { Project, ProjectsResponse } from '@acorn/protocol/api.ts'
import { createProject, deleteProject, detectProject, getProject, listProjects, patchProject, type ProjectRow } from '../../main/projects'
import { getProjectConfig, setProjectConfig, setProjectRunTargets } from '../../main/projectConfig'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// /v2/core/projects — the first-class folder-project surface (docs/workspaces-and-tasks.md).
// Unlike the removed pair-keyed route, this demands nothing of the folder: facets are detected, not
// validated. Project ids are the only live core identity for local folders and remote candidates.

const createBody = z.object({ path: z.string().min(1), workspaceId: z.string().optional(), name: z.string().max(120).optional() })
const patchBody = z.object({
  name: z.string().max(120).optional(),
  workspaceId: z.string().optional(),
  hidden: z.boolean().optional(),
  sort: z.number().int().optional(),
  path: z.string().min(1).optional(),
})
const browserRuleBody = z.object({
  id: z.string(),
  enabled: z.boolean(),
  urlPattern: z.string(),
  trigger: z.literal('load'),
  action: z.object({ type: z.literal('fill'), selector: z.string(), value: z.string() }),
})
const configBody = z.object({
  patch: z.object({
    setupScript: z.string().optional(),
    setupScriptTrigger: z.enum(['off', 'created', 'terminal']).optional(),
    teardownScript: z.string().optional(),
    devScript: z.string().optional(),
    devRestartScript: z.string().optional(),
    dbUrlScript: z.string().optional(),
    dbSchemaMode: z.enum(['auto', 'script', 'file']).or(z.literal('')).optional(),
    dbSchemaValue: z.string().optional(),
    dbSchemaNotes: z.string().max(8000).optional(),
    previewMode: z.enum(['url', 'port', 'script']).or(z.literal('')).optional(),
    previewValue: z.string().optional(),
    browserRules: z.array(browserRuleBody).optional(),
    branchPrefix: z.string().max(60).optional(),
  }),
})
const runTargetsBody = z.object({ runTargets: z.string() })

export const toWireProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  path: row.path,
  workspaceId: row.workspaceId,
  sort: row.sort,
  hidden: row.hidden,
  vcs: (row.vcs as 'git' | null) ?? null,
  defaultBranch: row.defaultBranch,
  remoteUrl: row.remoteUrl,
  github: row.githubOwner && row.githubName ? { owner: row.githubOwner, name: row.githubName, repoId: row.githubRepoId } : null,
})

export const projects = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await listProjects(getDb(c.env))
    return c.json({ projects: rows.map(toWireProject) } satisfies ProjectsResponse)
  })
  .post('/', async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['path is required.'])
    const result = await createProject(getDb(c.env), parsed.data)
    if (!result.ok) return respondError(c, 400, 'bad_request', [result.reason])
    return c.json({ project: toWireProject(result.project) })
  })
  .get('/:id/config', async (c) => {
    const response = await getProjectConfig(getDb(c.env), c.req.param('id'))
    if (!response) return respondError(c, 404, 'not_found', ['No such project.'])
    return c.json(response)
  })
  .put('/:id/config', async (c) => {
    const parsed = configBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Invalid project configuration.'])
    const result = await setProjectConfig(getDb(c.env), c.req.param('id'), parsed.data.patch)
    if (!result.ok) return respondError(c, result.reason === 'No such project.' ? 404 : 400, result.reason === 'No such project.' ? 'not_found' : 'bad_request', [result.reason])
    return c.json(result.response)
  })
  .put('/:id/run-targets', async (c) => {
    const parsed = runTargetsBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['runTargets is required.'])
    const result = await setProjectRunTargets(getDb(c.env), c.req.param('id'), parsed.data.runTargets)
    if (!result.ok) return respondError(c, result.reason === 'No such project.' ? 404 : 400, result.reason === 'No such project.' ? 'not_found' : 'bad_request', [result.reason])
    return c.json(result.response)
  })
  .patch('/:id', async (c) => {
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', ['Invalid project patch.'])
    const result = await patchProject(getDb(c.env), c.req.param('id'), parsed.data)
    if (!result.ok) {
      return result.reason === 'No such project.'
        ? respondError(c, 404, 'not_found', [result.reason])
        : respondError(c, 400, 'bad_request', [result.reason])
    }
    return c.json({ project: toWireProject(result.project) })
  })
  .post('/:id/detect', async (c) => {
    const row = await detectProject(getDb(c.env), c.req.param('id'))
    if (!row) return respondError(c, 404, 'not_found', ['No such project.'])
    return c.json({ project: toWireProject(row) })
  })
  .delete('/:id', async (c) => {
    const db = getDb(c.env)
    if (!(await getProject(db, c.req.param('id')))) return respondError(c, 404, 'not_found', ['No such project.'])
    // Row only — the folder and any worktrees on disk are never touched from here.
    await deleteProject(db, c.req.param('id'))
    return c.json({ ok: true })
  })
