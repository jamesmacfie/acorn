import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { MemoryRow } from '../contract/library'
import { registerKnowledgeChannel } from './knowledgeChannel'
import { serializeMemory } from './memory'
import { createMemorySourceHandler } from './memorySourceHandler'

const service = { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, userId: 'owner' } as never
const DAY = 86_400_000
const NOW = Date.now()

const projects = {
  byId: async (id: string) => [alpha, beta, outside].find((project) => project.id === id) ?? null,
  byWorkspace: async (id: string) => (id === 'workspace-a' ? [alpha, beta] : []),
} as never
const alpha = { id: 'project-a', name: 'Alpha' }
const beta = { id: 'project-b', name: 'Beta' }
const outside = { id: 'project-c', name: 'Elsewhere' }

type Page = {
  records: { recordId: string; data: Record<string, unknown>; target?: { kind: string; item: string } }[]
  completeness: { kind: string; cursor?: string; cause?: string }
  coveredRange?: { start: number }
}

const post = (handler: PluginFetchHandler, body: object, context = service) =>
  handler(
    new Request('http://plugin/v1/p/memory/data/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context,
  )

/** Every page of a query, as a panel's run reads it. */
async function readAll(
  handler: PluginFetchHandler,
  scope: { workspaceId?: string; projectId?: string },
  predicate?: DataPredicate,
) {
  const records: Page['records'] = []
  let cursor: string | undefined
  for (;;) {
    const response = await post(handler, {
      operation: 'query',
      mode: 'execution',
      evaluationTime: NOW,
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
      query: {
        source: { pluginId: 'memory', sourceId: 'memories' },
        scope: { ...scope, parameters: {} },
        sort: [],
        ...(predicate ? { predicate } : {}),
      },
    })
    expect(response.status).toBe(200)
    const page = (await response.json()) as Page
    records.push(...page.records)
    if (page.completeness.kind !== 'more') return { ...page, records }
    cursor = page.completeness.cursor
  }
}

describe('the Memories data source', () => {
  let dataRoot: string
  let handler: PluginFetchHandler

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'acorn-memory-source-'))
    vi.stubEnv('ACORN_DATA_DIR', dataRoot)
    handler = createMemorySourceHandler(registerKnowledgeChannel({} as never, {}).list, projects)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(dataRoot, { recursive: true, force: true })
  })

  /** A memory file, last touched `daysAgo` days ago. */
  async function memory(
    dir: string,
    name: string,
    options: { daysAgo?: number; updatedBy?: string; supersededBy?: string; type?: 'user' | 'feedback' } = {},
  ) {
    const folder = join(dataRoot, 'memory', dir)
    await mkdir(folder, { recursive: true })
    const file = join(folder, `${name}.md`)
    await writeFile(
      file,
      serializeMemory({
        name,
        description: `What ${name} says`,
        type: options.type ?? 'feedback',
        body: `SECRET-BODY of ${name}`,
        originSessionId: null,
        commitSha: null,
        supersededBy: options.supersededBy ?? null,
        createdAt: NOW - 100 * DAY,
        ...(options.updatedBy ? { updatedBy: options.updatedBy } : {}),
      }),
    )
    const at = new Date(NOW - (options.daysAgo ?? 0) * DAY)
    await utimes(file, at, at)
  }

  it('reads a project with your private memories, and a workspace with each of its projects', async () => {
    await memory('', 'everywhere')
    await memory('projects/project-a', 'alpha-rule')
    await memory('projects/project-b', 'beta-rule')
    await memory('projects/project-c', 'elsewhere-rule')

    const names = (page: { records: Page['records'] }) => page.records.map((record) => record.data.name).sort()
    expect(names(await readAll(handler, { workspaceId: 'workspace-a', projectId: 'project-a' }))).toEqual([
      'alpha-rule',
      'everywhere',
    ])
    expect(names(await readAll(handler, { projectId: 'project-b' }))).toEqual(['beta-rule', 'everywhere'])
    expect(names(await readAll(handler, { workspaceId: 'workspace-a' }))).toEqual([
      'alpha-rule',
      'beta-rule',
      'everywhere',
    ])
  })

  it('refuses a project outside the workspace and a read that names no scope', async () => {
    const query = (scope: object) => ({
      operation: 'query',
      mode: 'execution',
      evaluationTime: NOW,
      query: { source: { pluginId: 'memory', sourceId: 'memories' }, scope: { ...scope, parameters: {} }, sort: [] },
    })
    expect((await post(handler, query({ workspaceId: 'workspace-a', projectId: 'project-c' }))).status).toBe(502)
    expect((await post(handler, query({}))).status).toBe(502)
    const task = { principal: { kind: 'task', taskId: 'task-a' }, userId: 'owner' } as never
    expect((await post(handler, query({ workspaceId: 'workspace-a' }), task)).status).toBe(403)
  })

  it('keeps the frontmatter, opens a project memory, and never sends the body', async () => {
    await memory('', 'mine', { updatedBy: 'owner', type: 'user' })
    await memory('projects/project-a', 'learned', { updatedBy: 'agent:session-1', supersededBy: 'newer' })
    await memory('projects/project-a', 'hand-written')

    const { records } = await readAll(handler, { workspaceId: 'workspace-a' })
    const byName = Object.fromEntries(records.map((record) => [record.data.name, record]))
    expect(byName.learned).toEqual({
      recordId: 'project:project-a:learned',
      data: {
        name: 'learned',
        description: 'What learned says',
        type: 'feedback',
        scope: 'project',
        projectId: 'project-a',
        projectName: 'Alpha',
        writtenBy: 'agent',
        sessionId: 'session-1',
        createdAt: NOW - 100 * DAY,
        updatedAt: expect.any(Number),
        superseded: true,
      },
      target: { kind: 'memory.entry', item: 'project-a/learned' },
    })
    expect(byName.mine).toMatchObject({
      recordId: 'private::mine',
      data: { scope: 'private', projectId: null, projectName: null, writtenBy: 'owner', sessionId: null, type: 'user' },
    })
    expect(byName.mine.target).toBeUndefined()
    expect(byName['hand-written'].data).toMatchObject({ writtenBy: null, superseded: false })
    expect(JSON.stringify(records)).not.toContain('SECRET-BODY')
  })

  it('narrows to a time window on the updated time', async () => {
    await memory('projects/project-a', 'fresh', { daysAgo: 1 })
    await memory('projects/project-a', 'stale', { daysAgo: 200 })
    const { records } = await readAll(
      handler,
      { projectId: 'project-a' },
      {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/updatedAt' } },
        operator: 'lt',
        right: { address: { from: 'literal', value: NOW - 90 * DAY } },
      },
    )
    expect(records.map((record) => record.data.name)).toEqual(['stale'])
  })

  it('keeps the most recently updated memories when the library outgrows the budget', async () => {
    const row = (index: number): MemoryRow => ({
      id: `id-${index}`,
      scope: 'private',
      projectId: null,
      name: `memory-${index}`,
      type: 'reference',
      description: 'A fact',
      body: 'SECRET-BODY',
      path: `/memory/memory-${index}.md`,
      originSessionId: null,
      commitSha: null,
      supersededBy: null,
      createdAt: index,
      updatedAt: index,
    })
    const rows = Array.from({ length: DATA_LIMITS.selectionRecords + 1 }, (_, index) => row(index))
    const list = async (_projectId: string | null, scope?: string) => (scope === 'private' ? rows : [])
    const read = await readAll(createMemorySourceHandler(list, projects), { projectId: 'project-a' })
    expect(read.records).toHaveLength(DATA_LIMITS.selectionRecords)
    expect(read.records.some((record) => record.data.name === 'memory-0')).toBe(false)
    expect(read.completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
    expect(read.coveredRange?.start).toBe(1)
  })
})
