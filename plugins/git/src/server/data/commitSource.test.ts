// The Git commits source against real repositories and core's own project rows (docs/git-client/history.md).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTestNodeContext, schema as core, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { createCommitSourceHandler } from './commitSource'

const context = { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, userId: 'owner' } as never
const OCTOBER = Date.UTC(2026, 9, 1)

type Page = {
  records: { recordId: string; data: Record<string, unknown> }[]
  completeness: { kind: string; cursor?: string; cause?: string }
  coveredRange?: { start: number }
}

let ctx: TestNodeContext
let folder: string
beforeEach(() => {
  ctx = makeTestNodeContext({ plugin: { name: 'git' } })
  folder = mkdtempSync(join(tmpdir(), 'acorn-commits-'))
})
afterEach(() => {
  ctx.cleanup()
  rmSync(folder, { recursive: true, force: true })
})

const git = (cwd: string, args: string[], at?: number, input?: string) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      ...(at ? { GIT_AUTHOR_DATE: `@${at / 1000}`, GIT_COMMITTER_DATE: `@${at / 1000}` } : {}),
    },
  })
function repository(name: string) {
  const root = join(folder, name)
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  git(root, ['config', 'user.name', 'Acorn Test'])
  git(root, ['config', 'user.email', 'test@acorn.dev'])
  return root
}
const commit = (root: string, file: string, content: string, message: string, at: number) => {
  writeFileSync(join(root, file), content)
  git(root, ['add', file])
  git(root, ['commit', '-q', '-m', message], at)
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

/** Every page of one query at one evaluation time, as a panel's run reads it. */
async function readAll(
  handler: PluginFetchHandler,
  scope: { workspaceId?: string; projectId?: string },
  predicate?: DataPredicate,
) {
  const evaluationTime = Date.now()
  const records: Page['records'] = []
  let cursor: string | undefined
  for (;;) {
    const response = await handler(
      new Request('http://plugin/v1/p/git/data/commits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'query',
          mode: 'execution',
          evaluationTime,
          pageSize: 100,
          ...(cursor ? { cursor } : {}),
          query: {
            source: { pluginId: 'git', sourceId: 'commits' },
            scope: { ...scope, parameters: {} },
            sort: [],
            ...(predicate ? { predicate } : {}),
          },
        }),
      }),
      context,
    )
    expect(response.status).toBe(200)
    const page = (await response.json()) as Page
    records.push(...page.records)
    if (page.completeness.kind !== 'more') return { records, completeness: page.completeness, page }
    cursor = page.completeness.cursor
  }
}
const after = (value: number): DataPredicate => ({
  kind: 'comparison',
  left: { address: { from: 'item', pointer: '/authoredAt' } },
  operator: 'gt',
  right: { address: { from: 'literal', value } },
})

it('reads one record per commit per project, with its stat, merge flag, and first subject line', async () => {
  const root = repository('app')
  commit(root, 'a.txt', 'one\ntwo\n', 'Add a', OCTOBER + 1_000)
  git(root, ['checkout', '-q', '-b', 'feature'])
  commit(root, 'b.txt', 'b\n', 'Add b\n\nWith a body line.', OCTOBER + 2_000)
  git(root, ['checkout', '-q', 'main'])
  commit(root, 'a.txt', 'one\n', 'Trim a', OCTOBER + 3_000)
  git(root, ['merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature'], OCTOBER + 4_000)
  const workspaceId = await workspace()
  const projectId = await project(workspaceId, 'App', root)

  const { records, completeness } = await readAll(createCommitSourceHandler(ctx.core), { workspaceId })

  expect(completeness).toEqual({ kind: 'complete' })
  const bySubject = Object.fromEntries(records.map((record) => [record.data.subject, record]))
  expect(Object.keys(bySubject).sort()).toEqual(['Add a', 'Add b', 'Merge feature', 'Trim a'])
  const sha = git(root, ['rev-parse', 'feature']).trim()
  expect(bySubject['Add b']).toEqual({
    recordId: `${projectId}:${sha}`,
    data: {
      sha,
      subject: 'Add b',
      authorName: 'Acorn Test',
      authorEmail: 'test@acorn.dev',
      authoredAt: OCTOBER + 2_000,
      projectId,
      projectName: 'App',
      branch: expect.stringMatching(/^(main|feature)$/),
      filesChanged: 1,
      linesAdded: 1,
      linesRemoved: 0,
      merge: false,
    },
  })
  expect(bySubject['Trim a']!.data).toMatchObject({ filesChanged: 1, linesAdded: 0, linesRemoved: 1 })
  expect(bySubject['Merge feature']!.data).toMatchObject({ merge: true, filesChanged: 0, branch: 'main' })
})

it('reads a workspace’s projects, one project, or with neither every project on the Node', async () => {
  const first = repository('first')
  commit(first, 'f.txt', 'f\n', 'First', OCTOBER)
  const second = repository('second')
  commit(second, 's.txt', 's\n', 'Second', OCTOBER)
  const workspaceId = await workspace()
  const firstId = await project(workspaceId, 'First', first)
  await project(workspaceId, 'No checkout', null)
  await project(await workspace(), 'Second', second)
  // A folder that isn't a repository reads nothing rather than failing the read.
  await project(workspaceId, 'Plain folder', folder)
  const handler = createCommitSourceHandler(ctx.core)
  const subjects = async (scope: { workspaceId?: string; projectId?: string }) =>
    (await readAll(handler, scope)).records.map((record) => record.data.subject).sort()

  expect(await subjects({ workspaceId })).toEqual(['First'])
  expect(await subjects({ projectId: firstId })).toEqual(['First'])
  expect(await subjects({})).toEqual(['First', 'Second'])
})

it('narrows git log to the window and applies it to the author time', async () => {
  const root = repository('app')
  commit(root, 'a.txt', 'a\n', 'September', OCTOBER - 86_400_000)
  commit(root, 'b.txt', 'b\n', 'October', OCTOBER + 1_000)
  const projectId = await project(await workspace(), 'App', root)
  const calls: string[][] = []
  const handler = createCommitSourceHandler({
    ...ctx.core,
    git: {
      ...ctx.core.git,
      git: (args, opts) => {
        calls.push([...args])
        return ctx.core.git.git(args, opts)
      },
    },
  })

  const { records } = await readAll(handler, { projectId }, after(OCTOBER))

  expect(records.map((record) => record.data.subject)).toEqual(['October'])
  expect(calls.find((args) => args[0] === 'log')).toContain(`--since=@${OCTOBER / 1000}`)
})

it('keeps the newest 5,000 commits and says the read is incomplete from the oldest it kept', async () => {
  const root = repository('big')
  // fast-import writes 5,002 commits in well under a second.
  let stream = ''
  for (let index = 1; index <= 5_002; index++) {
    const seconds = OCTOBER / 1000 + index
    const message = `Commit ${index}`
    const content = `${index}\n`
    stream += `commit refs/heads/main\ncommitter Acorn Test <test@acorn.dev> ${seconds} +0000\n`
    stream += `data ${message.length}\n${message}\nM 644 inline file.txt\ndata ${content.length}\n${content}\n`
  }
  git(root, ['fast-import', '--quiet'], undefined, stream)
  const projectId = await project(await workspace(), 'Big', root)

  const { records, completeness, page } = await readAll(createCommitSourceHandler(ctx.core), { projectId })

  expect(records).toHaveLength(5_000)
  expect(completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
  expect(Math.min(...records.map((record) => record.data.authoredAt as number))).toBe(OCTOBER + 3_000)
  expect(page.coveredRange?.start).toBe(OCTOBER + 3_000)
})
