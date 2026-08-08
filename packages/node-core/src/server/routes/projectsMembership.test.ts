import { Hono } from 'hono'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Task } from '@acorn/protocol/api.ts'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { projects } from './projects'
import { tasks } from './tasks'
import { workspaces } from './workspaces'
import { makeTestDb, type TestDb } from '../../testkit/db'
import type { Env } from '../../main/bindings'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

// The project contract: workspace membership and visibility are both owned by the project row.

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  app.route('/api/workspaces', workspaces)
  app.route('/api/tasks', tasks)
  app.route('/api/projects', projects)
  return app
}

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://acorn.test${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('project rows own workspace membership and visibility', () => {
  let t: TestDb
  let app: Hono<AppEnv>
  let dir: string

  beforeEach(() => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()
    dir = mkdtempSync(join(tmpdir(), 'acorn-projects-sync-'))
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const call = (url: string, method: string, body?: unknown) =>
    app.fetch(body === undefined ? new Request(`http://acorn.test${url}`, { method }) : jsonReq(url, method, body), {} as Env)

  const projectRows = () => t.db.select().from(schema.projects)

  const createWorkspace = async (name: string): Promise<string> => {
    const res = await call('/api/workspaces', 'POST', { name })
    return ((await res.json()) as { id: string }).id
  }

  it('moves a known project between workspaces and toggles visibility by project id', async () => {
    const w1 = await createWorkspace('One')
    const w2 = await createWorkspace('Two')
    const now = Date.now()
    await t.db.insert(schema.projects).values({
      id: 'project-web', name: 'web', path: null, workspaceId: w1, sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/web.git', githubOwner: 'acme', githubName: 'web', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })

    expect((await call('/api/projects/project-web', 'PATCH', { workspaceId: w2 })).status).toBe(200)
    let [project] = await projectRows()
    expect(project).toMatchObject({ githubOwner: 'acme', githubName: 'web', workspaceId: w2, path: null, hidden: false })

    await call('/api/projects/project-web', 'PATCH', { hidden: true })
    ;[project] = await projectRows()
    expect(project.hidden).toBe(true)

    await call('/api/projects/project-web', 'PATCH', { hidden: false })
    ;[project] = await projectRows()
    expect(project.hidden).toBe(false)
    expect(await projectRows()).toHaveLength(1)
  })

  it('deleting a workspace moves its projects to Default', async () => {
    const w1 = await createWorkspace('Doomed')
    const now = Date.now()
    await t.db.insert(schema.projects).values({
      id: 'project-web', name: 'web', path: null, workspaceId: w1, sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/web.git', githubOwner: 'acme', githubName: 'web', githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
    // Creating any workspace does not create Default; deleting one must.
    await call(`/api/workspaces/${w1}`, 'DELETE')
    const [project] = await projectRows()
    const [defaultWs] = await t.db.select().from(schema.workspaces).where(eq(schema.workspaces.isDefault, true))
    expect(defaultWs).toBeTruthy()
    expect(project.workspaceId).toBe(defaultWs.id)
  })

  it('creating a task stamps the supplied project id', async () => {
    const workspace = await createWorkspace('Tasks')
    const createdProject = await call('/api/projects', 'POST', { path: dir, workspaceId: workspace, name: 'repo' })
    const { project: folderProject } = (await createdProject.json()) as { project: Project }
    const res = await call('/api/tasks', 'POST', { origin: 'local', projectId: folderProject.id, branch: 'main' })
    expect(res.status).toBe(200)
    const task = (await res.json()) as Task
    const [row] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id))
    expect(row.projectId).toBe(folderProject.id)
  })

  it('the /projects surface adds a plain folder and lists it', async () => {
    const folder = join(dir, 'scratch')
    mkdirSync(folder)
    const created = await call('/api/projects', 'POST', { path: folder })
    expect(created.status).toBe(200)
    const { project } = (await created.json()) as { project: Project }
    expect(project).toMatchObject({ name: 'scratch', path: folder, vcs: null, github: null })

    const listed = await call('/api/projects', 'GET')
    const body = (await listed.json()) as { projects: Project[] }
    expect(body.projects.map((p) => p.id)).toContain(project.id)

    expect((await call(`/api/projects/${project.id}`, 'PATCH', { hidden: true })).status).toBe(200)
    expect((await call(`/api/projects/${project.id}`, 'DELETE')).status).toBe(200)
    expect((await (await call('/api/projects', 'GET')).json() as { projects: Project[] }).projects).toHaveLength(0)
  })

  it('stores project config and run targets through project-keyed routes', async () => {
    const folder = join(dir, 'configured')
    mkdirSync(folder)
    const created = await call('/api/projects', 'POST', { path: folder })
    const { project } = (await created.json()) as { project: Project }

    const config = await call(`/api/projects/${project.id}/config`, 'PUT', {
      patch: { setupScript: 'pnpm install', previewMode: 'port', previewValue: '3000' },
    })
    expect(config.status).toBe(200)
    const targets = await call(`/api/projects/${project.id}/run-targets`, 'PUT', { runTargets: '[{"id":"dev","command":"pnpm dev"}]' })
    expect(targets.status).toBe(200)

    const [row] = await projectRows()
    expect(row).toMatchObject({ setupScript: 'pnpm install', previewMode: 'port', previewValue: '3000', runTargets: '[{"id":"dev","command":"pnpm dev"}]' })
  })

  it('project visibility does not affect plain-folder identity', async () => {
    const folder = join(dir, 'plain')
    mkdirSync(folder)
    const created = await call('/api/projects', 'POST', { path: folder })
    const { project } = (await created.json()) as { project: Project }
    expect((await call(`/api/projects/${project.id}`, 'PATCH', { hidden: true })).status).toBe(200)

    expect((await call(`/api/projects/${project.id}`, 'PATCH', { name: 'plain-renamed' })).status).toBe(200)
    const listed = (await (await call('/api/projects', 'GET')).json()) as { projects: Project[] }
    expect(listed.projects.find((row) => row.id === project.id)?.hidden).toBe(true)
  })
})
