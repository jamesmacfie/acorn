import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import type { DataSourceDescription, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { Env } from '../bindings'
import { gitText } from '../core/git'
import { getDb, schema } from '../db'
import { worktreeCounts } from './localGitRead'
import { createDataSelectionPager, selectDataRecords } from './selection'

const branchDescription: DataSourceDescription = {
  revision: '1', schema: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string' }, name: { type: 'string' }, upstream: { type: ['string', 'null'] },
    aheadUpstream: { type: ['number', 'null'] }, behindUpstream: { type: ['number', 'null'] },
    aheadDefault: { type: ['number', 'null'] }, behindDefault: { type: ['number', 'null'] },
    lastCommitAt: { type: ['number', 'null'] }, observedAt: { type: 'number' },
  }, required: ['projectId', 'name', 'upstream', 'aheadUpstream', 'behindUpstream', 'aheadDefault', 'behindDefault', 'lastCommitAt', 'observedAt'] },
  fields: [
    { pointer: '/name', label: 'Branch', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/upstream', label: 'Upstream', origin: 'declared' },
    ...(['aheadUpstream', 'behindUpstream', 'aheadDefault', 'behindDefault'] as const).map(key => ({ pointer: `/${key}`, label: key, origin: 'declared' as const, display: { kind: 'number' as const } })),
    { pointer: '/lastCommitAt', label: 'Last commit', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/observedAt', label: 'Observed', origin: 'declared', display: { kind: 'datetime' } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: { project: { type: 'string' } } },
  parameterFields: [{ pointer: '/project', label: 'Local project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  consistency: 'Local refs as last observed. Ahead and behind use the last fetched refs; this read never fetches.',
}

const worktreeDescription: DataSourceDescription = {
  revision: '1', schema: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string' }, path: { type: 'string' }, branch: { type: ['string', 'null'] },
    detachedHead: { type: ['string', 'null'] }, modifiedCount: { type: ['number', 'null'] },
    untrackedCount: { type: ['number', 'null'] }, lastCommitAt: { type: ['number', 'null'] },
    taskId: { type: ['string', 'null'] }, observedAt: { type: 'number' },
  }, required: ['projectId', 'path', 'branch', 'detachedHead', 'modifiedCount', 'untrackedCount', 'lastCommitAt', 'taskId', 'observedAt'] },
  fields: [
    { pointer: '/path', label: 'Worktree path', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/branch', label: 'Branch', origin: 'declared' },
    { pointer: '/detachedHead', label: 'Detached head', origin: 'declared' },
    { pointer: '/modifiedCount', label: 'Modified files', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/untrackedCount', label: 'Untracked files', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/lastCommitAt', label: 'Last commit', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/taskId', label: 'Task', origin: 'declared' },
    { pointer: '/observedAt', label: 'Observed', origin: 'declared', display: { kind: 'datetime' } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: { project: { type: 'string' } } },
  parameterFields: [{ pointer: '/project', label: 'Local project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  consistency: 'All live Git worktrees for the selected local project, including unmanaged and detached worktrees. Status is observed without fetching.',
}

const pager = createDataSelectionPager()
const key = (projectId: string, value: string) => createHash('sha256').update(`${projectId}\0${value}`).digest('hex')
const time = async (path: string): Promise<number | null> => {
  try { const value = Number(await gitText(['show', '-s', '--format=%ct', 'HEAD'], { cwd: path, timeoutMs: 10_000 })); return Number.isFinite(value) ? value * 1000 : null }
  catch { return null }
}
const divergence = async (path: string, branch: string, base: string | null): Promise<{ ahead: number; behind: number } | null> => {
  if (!base) return null
  try {
    const [ahead, behind] = (await gitText(['rev-list', '--left-right', '--count', `${branch}...${base}`], { cwd: path, timeoutMs: 10_000 })).split(/\s+/).map(Number)
    return Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead: ahead!, behind: behind! } : null
  } catch { return null }
}

export function parseLocalWorktrees(roster: string): { path: string; branch: string | null; head: string | null }[] {
  return roster.split('\0\0').flatMap(entry => {
    const fields = entry.split('\0')
    if (fields.includes('bare') || fields.some(field => field.startsWith('prunable'))) return []
    const path = fields.find(field => field.startsWith('worktree '))?.slice(9)
    if (!path) return []
    return [{ path, branch: fields.find(field => field.startsWith('branch refs/heads/'))?.slice(18) ?? null,
      head: fields.find(field => field.startsWith('HEAD '))?.slice(5) ?? null }]
  })
}

async function projectPath(request: Extract<DataSourceRequest, { operation: 'query' }>, env: Env) {
  const selected = request.query.scope.parameters.project
  const id = request.query.scope.projectId ?? (typeof selected === 'string' ? selected : undefined)
  if (!id) throw new Error('Choose a local project.')
  if (request.query.scope.projectId && selected && selected !== request.query.scope.projectId) throw new Error('project_scope_mismatch')
  const [project] = await getDb(env).select().from(schema.projects).where(eq(schema.projects.id, id))
  if (!project || project.workspaceId !== request.query.scope.workspaceId || project.vcs !== 'git' || !project.path) throw new Error('git_project_unavailable')
  return project
}

async function projectOptions(request: Extract<DataSourceRequest, { operation: 'options' }>, env: Env) {
  if (request.target !== 'parameter' || request.pointer !== '/project') throw new Error('unsupported_options')
  const workspaceId = request.scope.workspaceId
  if (!workspaceId) throw new Error('workspace_required')
  const projects = await getDb(env).select({ id: schema.projects.id, name: schema.projects.name, vcs: schema.projects.vcs,
    path: schema.projects.path, hidden: schema.projects.hidden }).from(schema.projects)
    .where(eq(schema.projects.workspaceId, workspaceId))
  const matching = projects.filter(project => project.vcs === 'git' && project.path && !project.hidden
    && project.name.toLowerCase().includes(request.search.toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name))
  const offset = Number(request.cursor ?? 0)
  if (!Number.isInteger(offset) || offset < 0) throw new Error('invalid_cursor')
  const page = matching.slice(offset, offset + request.pageSize)
  const next = offset + page.length
  return { options: page.map(project => ({ id: project.id, label: project.name.slice(0, 80) })),
    ...(next < matching.length ? { nextCursor: String(next) } : {}), exhausted: next >= matching.length }
}

export async function localBranches(request: DataSourceRequest, env: Env) {
  if (request.operation === 'describe') return branchDescription
  if (request.operation === 'options') return projectOptions(request, env)
  if (request.operation !== 'query') throw new Error('unsupported_operation')
  return pager(env.ACTIVE_IDENTITY.get() ?? '', request, async () => {
    const project = await projectPath(request, env)
    const path = project.path!
    const observedAt = Date.now()
    const refs = await gitText(['for-each-ref', '--format=%(refname:short)%00%(upstream:short)%00%(committerdate:unix)', 'refs/heads'], { cwd: path, timeoutMs: 10_000 })
    const rows = refs.split('\n').filter(Boolean)
    const records = []
    for (let index = 0; index < rows.length; index += 4) {
      records.push(...await Promise.all(rows.slice(index, index + 4).map(async row => {
        const [name = '', upstream = '', stamp = ''] = row.split('\0')
        const branch = `refs/heads/${name}`
        const [againstUpstream, againstDefault] = await Promise.all([
          divergence(path, branch, upstream || null),
          divergence(path, branch, project.defaultBranch ? `refs/heads/${project.defaultBranch}` : null),
        ])
        return { recordId: key(project.id, name), data: { projectId: project.id, name, upstream: upstream || null,
          aheadUpstream: againstUpstream?.ahead ?? null, behindUpstream: againstUpstream?.behind ?? null,
          aheadDefault: againstDefault?.ahead ?? null, behindDefault: againstDefault?.behind ?? null,
          lastCommitAt: stamp ? Number(stamp) * 1000 : null, observedAt }, display: { title: name } }
      })))
    }
    return { ...selectDataRecords(records, request.query), revision: branchDescription.revision, readTime: observedAt, observedAt }
  })
}

export async function localWorktrees(request: DataSourceRequest, env: Env) {
  if (request.operation === 'describe') return worktreeDescription
  if (request.operation === 'options') return projectOptions(request, env)
  if (request.operation !== 'query') throw new Error('unsupported_operation')
  return pager(env.ACTIVE_IDENTITY.get() ?? '', request, async () => {
    const project = await projectPath(request, env)
    const observedAt = Date.now()
    const roster = parseLocalWorktrees(await gitText(['worktree', 'list', '--porcelain', '-z'], { cwd: project.path!, timeoutMs: 10_000 }))
    const tasks = await getDb(env).select({ id: schema.tasks.id, path: schema.tasks.worktreePath }).from(schema.tasks).where(eq(schema.tasks.projectId, project.id))
    const owners = new Map(tasks.flatMap(task => task.path ? [[resolve(task.path), task.id] as const] : []))
    const records = []
    for (let index = 0; index < roster.length; index += 4) {
      records.push(...await Promise.all(roster.slice(index, index + 4).map(async tree => {
        const [counts, lastCommitAt] = await Promise.all([worktreeCounts(tree.path), time(tree.path)])
        const taskId = owners.get(resolve(tree.path)) ?? null
        return { recordId: key(project.id, resolve(tree.path)), data: { projectId: project.id, path: tree.path,
          branch: tree.branch, detachedHead: tree.branch ? null : tree.head,
          modifiedCount: counts?.modifiedCount ?? null, untrackedCount: counts?.untrackedCount ?? null,
          lastCommitAt, taskId, observedAt }, display: { title: tree.path }, ...(taskId ? { taskId } : {}) }
      })))
    }
    return { ...selectDataRecords(records, request.query), revision: worktreeDescription.revision, readTime: observedAt, observedAt }
  })
}
