import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Project, ProjectMcpFile, ProjectsResponse } from '@acorn/protocol/api.ts'
import { inspectMcpConfig, MCP_CANDIDATES, STARTER_MCP_JSON } from '@acorn/protocol/mcp.ts'
import { isValidProjectColor } from '@acorn/protocol/projectColor.ts'
import { createProject, deleteProject, detectProject, getProject, listProjects, patchProject, type ProjectRow } from '../../projects'
import { getProjectConfigWithRepo, setProjectConfig, setProjectRunTargets } from '../../projectConfig'
import { getDb } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { respondError } from '../../respond'
import { isTaskConfined } from '../../middleware/requireUser'
import { unclaimedWorktrees } from '../../worktrees/taskWorktree'
import { taskBranchAvailability, TaskBranchError } from '../../worktrees/taskBranch'
import { projectBranches } from '../../worktrees/branches'

// /v1/core/projects, the first-class folder-project surface (docs/workspaces-and-tasks.md).
// Unlike the removed pair-keyed route, this demands nothing of the folder: facets are detected, not
// validated. Project ids are the only live core identity for local folders and remote candidates.

const createBody = z.object({ path: z.string().min(1), workspaceId: z.string().optional(), name: z.string().max(120).optional() })
const patchBody = z.object({
  name: z.string().max(120).optional(),
  workspaceId: z.string().optional(),
  hidden: z.boolean().optional(),
  color: z.string().refine(isValidProjectColor).nullable().optional(),
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
  color: row.color,
  vcs: (row.vcs as 'git' | null) ?? null,
  defaultBranch: row.defaultBranch,
  remoteUrl: row.remoteUrl,
  github: row.githubOwner && row.githubName ? { owner: row.githubOwner, name: row.githubName, repoId: row.githubRepoId } : null,
})

// MCP config inspector (docs/mcp.md § Configuration): read only the known candidate files and mask
// secrets here, so raw values never cross to the renderer. Read-only, since acorn never launches these
// servers. Keyed by project rather than by task, because the files that matter are the ones committed
// to the project, which every task's worktree checks out, so Settings shows the same servers whether or
// not a task is open. A project with no folder yet reads the home file alone.
async function inspectProjectMcp(root: string | null): Promise<ProjectMcpFile[]> {
  const out: ProjectMcpFile[] = []
  for (const candidate of MCP_CANDIDATES) {
    const base = candidate.root === 'home' ? homedir() : root
    if (!base) continue
    const file = resolve(base, candidate.rel)
    try {
      out.push({ file, servers: inspectMcpConfig(await readFile(file, 'utf8')) })
    } catch {
      // absent file → not listed
    }
  }
  return out
}

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
  .get('/:id', async (c) => {
    const row = await getProject(getDb(c.env), c.req.param('id'))
    if (!row) return respondError(c, 404, 'not_found', ['No such project.'])
    return c.json(toWireProject(row))
  })
  .get('/:id/config', async (c) => {
    const response = await getProjectConfigWithRepo(getDb(c.env), c.req.param('id'))
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
  // Absolute paths of every free worktree are a layout disclosure, so a task-confined caller gets
  // none, as with the task list (docs/security/transport-and-auth.md § Transport and auth).
  .get('/:id/worktrees', async (c) => {
    if (isTaskConfined(c)) return respondError(c, 403, 'forbidden')
    const row = await getProject(getDb(c.env), c.req.param('id'))
    if (!row) return respondError(c, 404, 'not_found', ['No such project.'])
    return c.json(await unclaimedWorktrees(getDb(c.env), row))
  })
  .get('/:id/branches', async (c) => {
    if (isTaskConfined(c)) return respondError(c, 403, 'forbidden')
    const db = getDb(c.env)
    const project = await getProject(db, c.req.param('id'))
    if (!project) return respondError(c, 404, 'not_found', ['No such project.'])
    try {
      return c.json(await projectBranches(db, project))
    } catch {
      return respondError(c, 409, 'branches-unavailable', ['Could not list local branches.'])
    }
  })
  .get('/:id/worktree-availability', async (c) => {
    if (isTaskConfined(c)) return respondError(c, 403, 'forbidden')
    const branch = c.req.query('branch')
    if (!branch) return respondError(c, 400, 'bad_request', ['A branch name is required.'])
    const db = getDb(c.env)
    const project = await getProject(db, c.req.param('id'))
    if (!project) return respondError(c, 404, 'not_found', ['No such project.'])
    const branchSource = c.req.query('branchSource')
    if (branchSource !== undefined && branchSource !== 'derived' && branchSource !== 'exact') return respondError(c, 400, 'bad_request')
    try {
      const result = await taskBranchAvailability(db, project, { branch, branchSource, baseBranch: c.req.query('baseBranch') })
      // Preserve the response for callers that do not request a preview.
      if (!branchSource && c.req.query('baseBranch') === undefined) {
        const { branch: _branch, ...availability } = result
        return c.json(availability)
      }
      return c.json(result)
    } catch (error) {
      if (error instanceof TaskBranchError) return respondError(c, error.status, 'bad_request', [error.message])
      throw error
    }
  })
  .get('/:id/mcp', async (c) => {
    const row = await getProject(getDb(c.env), c.req.param('id'))
    if (!row) return respondError(c, 404, 'not_found', ['No such project.'])
    return c.json(await inspectProjectMcp(row.path))
  })
  // Seeds an empty .mcp.json in the project's folder, never over an existing one. The folder rather than
  // a task's worktree, because that is where the page reads it from; a task on a new branch picks it up
  // once it is committed.
  .post('/:id/mcp/starter', async (c) => {
    const row = await getProject(getDb(c.env), c.req.param('id'))
    if (!row) return respondError(c, 404, 'not_found', ['No such project.'])
    if (!row.path) return c.json({ ok: false, reason: 'This project has no folder on this node yet.' })
    // `wx` refuses any path that is already there, a symlink included, even one pointing nowhere. A
    // check before the write would follow a committed link and write wherever it points.
    try {
      await writeFile(resolve(row.path, '.mcp.json'), STARTER_MCP_JSON, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return c.json({ ok: false, reason: code === 'EEXIST' ? '.mcp.json already exists.' : `Could not write .mcp.json: ${code ?? 'unknown error'}.` })
    }
    return c.json({ ok: true })
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
    // Row only. The folder and any worktrees on disk are never touched from here.
    await deleteProject(db, c.req.param('id'))
    return c.json({ ok: true })
  })
