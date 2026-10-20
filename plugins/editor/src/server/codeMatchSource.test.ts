// The Code matches source against real folders and core's own project rows (docs/editor/find-in-files.md).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTestNodeContext, schema as core, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { codeMatchSourceDescription } from '../shared/codeMatchSource'
import { createCodeMatchSourceHandler } from './codeMatchSource'

const context = { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, userId: 'owner' } as never

type Record = { recordId: string; data: { [key: string]: unknown }; taskId?: string; target?: unknown }
type Page = { records: Record[]; completeness: { kind: string; cursor?: string; cause?: string } }

let ctx: TestNodeContext
let folder: string
beforeEach(() => {
  ctx = makeTestNodeContext({ plugin: { name: 'editor' } })
  folder = mkdtempSync(join(tmpdir(), 'acorn-code-matches-'))
})
afterEach(() => {
  ctx.cleanup()
  rmSync(folder, { recursive: true, force: true })
})

/** A file with `content`, last modified `age` seconds before now. */
function file(root: string, path: string, content: string, age = 0) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  const at = Date.now() / 1000 - age
  utimesSync(target, at, at)
}
function repository(name: string) {
  const root = join(folder, name)
  mkdirSync(root)
  execFileSync('git', ['init', '-q', root])
  return root
}
const workspace = async () => {
  const id = randomUUID()
  await ctx.db.insert(core.workspaces).values({ id, name: id, createdAt: 1, updatedAt: 1 })
  return id
}
const project = async (workspaceId: string, name: string, path: string | null) => {
  const id = randomUUID()
  await ctx.db.insert(core.projects).values({
    id,
    name,
    path,
    workspaceId,
    sort: 0,
    hidden: false,
    vcs: 'git',
    defaultBranch: 'main',
    remoteUrl: null,
    githubOwner: null,
    githubName: null,
    githubRepoId: null,
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}
const task = async (projectId: string, branch: string | null, worktreePath: string | null = null) => {
  const id = randomUUID()
  await ctx.db.insert(core.tasks).values({
    id,
    title: id,
    origin: 'local',
    projectId,
    branch,
    worktreePath,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** Every page of one query at one evaluation time, as a panel's run reads it. */
async function readAll(scope: { workspaceId?: string; projectId?: string }, parameters: { [key: string]: unknown }) {
  const handler = createCodeMatchSourceHandler(ctx.core)
  const evaluationTime = Date.now()
  const records: Record[] = []
  let cursor: string | undefined
  for (;;) {
    const response = await handler(
      new Request('http://plugin/v1/p/editor/data/code-matches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'query',
          mode: 'execution',
          evaluationTime,
          pageSize: 100,
          ...(cursor ? { cursor } : {}),
          query: {
            source: { pluginId: 'editor', sourceId: 'code-matches' },
            scope: { ...scope, parameters },
            sort: [],
          },
        }),
      }),
      context,
    )
    if (response.status !== 200) return { status: response.status, records, completeness: undefined }
    const page = (await response.json()) as Page
    records.push(...page.records)
    if (page.completeness.kind !== 'more') return { status: 200, records, completeness: page.completeness }
    cursor = page.completeness.cursor
  }
}

it('reads one record per match, with its folder, file type, line text, task, and editor target', async () => {
  const root = repository('app')
  file(root, 'src/server/api/routes.ts', `const a = 1\n// todo: tidy ${'x'.repeat(300)}\n`)
  file(root, 'README.md', 'TODO write me\n')
  const workspaceId = await workspace()
  const projectId = await project(workspaceId, 'App', root)
  const taskId = await task(projectId, null)
  await task(projectId, 'feature')
  const elsewhere = await project(workspaceId, 'Elsewhere', repository('elsewhere'))
  // A task made on the existing checkout keeps its branch name, and still reads the same folder.
  const checkoutTask = await task(elsewhere, 'main', join(folder, 'elsewhere'))
  file(join(folder, 'elsewhere'), 'b.ts', 'TODO\n')

  const { records, completeness } = await readAll({ workspaceId }, { pattern: 'TODO' })

  expect(completeness).toEqual({ kind: 'complete' })
  const byPath = Object.fromEntries(records.map((record) => [record.data.path, record]))
  expect(byPath['src/server/api/routes.ts']).toEqual({
    recordId: expect.stringMatching(/^[0-9a-f]{64}$/),
    data: {
      project: projectId,
      projectName: 'App',
      path: 'src/server/api/routes.ts',
      folder: 'src/server',
      extension: 'ts',
      line: 2,
      text: `// todo: tidy ${'x'.repeat(186)}`,
    },
    taskId,
    target: { kind: 'editor.file', item: '2:src/server/api/routes.ts' },
  })
  expect(byPath['README.md']!.data).toMatchObject({ folder: '.', extension: 'md', line: 1 })
  expect(byPath['b.ts']!.taskId).toBe(checkoutTask)
})

it("searches the workspace's project folders or one project, and fails a query that names neither", async () => {
  const first = repository('first')
  file(first, 'a.ts', 'TODO first\n')
  const second = repository('second')
  file(second, 'b.ts', 'TODO second\n')
  const elsewhere = repository('elsewhere')
  file(elsewhere, 'c.ts', 'TODO elsewhere\n')
  const workspaceId = await workspace()
  const firstId = await project(workspaceId, 'First', first)
  await project(workspaceId, 'Second', second)
  await project(workspaceId, 'No folder', null)
  await project(workspaceId, 'Gone', join(folder, 'gone'))
  await project(await workspace(), 'Elsewhere', elsewhere)
  const names = async (scope: { workspaceId?: string; projectId?: string }) =>
    (await readAll(scope, { pattern: 'TODO' })).records.map((record) => record.data.projectName).sort()

  expect(await names({ workspaceId })).toEqual(['First', 'Second'])
  expect(await names({ projectId: firstId })).toEqual(['First'])
  expect((await readAll({}, { pattern: 'TODO' })).status).toBe(502)
  expect((await readAll({ workspaceId }, { pattern: '' })).status).toBe(502)
})

it('honours .gitignore, even when the file-name glob matches an ignored file', async () => {
  const root = repository('app')
  file(root, '.gitignore', 'generated.ts\n')
  file(root, 'generated.ts', 'TODO ignored\n')
  file(root, 'kept.ts', 'TODO kept\n')
  file(root, 'notes.md', 'TODO notes\n')
  const projectId = await project(await workspace(), 'App', root)
  const paths = async (parameters: { [key: string]: unknown }) =>
    (await readAll({ projectId }, parameters)).records.map((record) => record.data.path).sort()

  expect(await paths({ pattern: 'TODO' })).toEqual(['kept.ts', 'notes.md'])
  expect(await paths({ pattern: 'TODO', glob: '*.ts' })).toEqual(['kept.ts'])
})

it('reads the pattern as fixed text unless regex is on, and ignores case unless asked', async () => {
  const root = repository('app')
  file(root, 'a.ts', 'value as any\nTODO(x)\ntodo(y)\n')
  const projectId = await project(await workspace(), 'App', root)
  const lines = async (parameters: { [key: string]: unknown }) =>
    (await readAll({ projectId }, parameters)).records.map((record) => record.data.line).sort()

  expect(await lines({ pattern: 'TODO(' })).toEqual([2, 3])
  expect(await lines({ pattern: 'TODO(', caseSensitive: true })).toEqual([2])
  expect(await lines({ pattern: 'as an?y', regex: true })).toEqual([1])
})

it('keeps the newest-modified files’ first 5,000 matches across projects and says the read is incomplete', async () => {
  const old = repository('old')
  file(old, 'old.txt', 'TODO\n'.repeat(5_000), 3_600)
  const fresh = repository('fresh')
  file(fresh, 'fresh.txt', 'TODO\n'.repeat(10))
  const workspaceId = await workspace()
  await project(workspaceId, 'Old', old)
  await project(workspaceId, 'Fresh', fresh)

  const { records, completeness } = await readAll({ workspaceId }, { pattern: 'TODO' })

  expect(records).toHaveLength(5_000)
  expect(completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
  expect(records.filter((record) => record.data.path === 'fresh.txt')).toHaveLength(10)
})

it("starter plans fit the source's own description", () => {
  const description = dataSourceDescriptionSchema.parse(codeMatchSourceDescription)
  expect(description.starterPlans?.length).toBe(3)
  for (const starter of description.starterPlans ?? []) {
    const plan = panelPlanSchema.parse(starter)
    const sources = plan.sources.map((source) => {
      if (source.reference.kind !== 'inline') throw new Error('A starter reads its source inline.')
      return { instanceId: source.id, label: source.label, query: source.reference.content.query, description }
    })
    expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
  }
})
