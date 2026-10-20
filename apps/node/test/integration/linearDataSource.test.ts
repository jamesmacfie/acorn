import { afterEach, expect, it, vi } from 'vitest'
import { linearPlugin } from '@acorn/plugin-linear/node/index.ts'
import { cycleSourceDescription, projectSourceDescription } from '@acorn/plugin-linear/testkit'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { clearRegistrations, initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import '@acorn/node-core/server/index.ts'
import { makeTestDb, testEnv, runDashboard, testCoreSeams } from '@acorn/node-core/testkit'

afterEach(() => {
  clearRegistrations('linear')
  vi.unstubAllGlobals()
})

const day = 86_400_000
const now = Date.parse('2026-10-20T00:00:00Z')
const iso = (time: number) => new Date(time).toISOString()
const page = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })
const cycle = (id: string, endsAt: number, flags: { isActive?: boolean; isFuture?: boolean } = {}) => ({
  id,
  number: Number(id.slice(1)),
  name: null,
  startsAt: iso(endsAt - 14 * day),
  endsAt: iso(endsAt),
  completedAt: null,
  progress: 0.5,
  isActive: flags.isActive ?? false,
  isFuture: flags.isFuture ?? false,
  issueCountHistory: [4, 6],
  completedIssueCountHistory: [1, 3],
  team: { id: 'team1', key: 'ENG', name: 'Engineering' },
})
const project = (id: string, type: string, targetDate: string | null, completedAt: number | null) => ({
  id,
  name: id,
  url: `https://linear.app/acme/project/${id}`,
  status: { name: type, type },
  lead: { name: 'Ada' },
  teams: { nodes: [{ name: 'Engineering' }] },
  progress: 0.3,
  targetDate,
  startedAt: iso(now - 60 * day),
  completedAt: completedAt === null ? null : iso(completedAt),
  updatedAt: iso(now - day),
})
const CYCLES = [
  cycle('c13', now + 7 * day, { isActive: true }),
  cycle('c12', now - 7 * day),
  cycle('c14', now + 21 * day, { isFuture: true }),
]
const PROJECTS = [
  project('late', 'started', '2026-10-01', null),
  project('on-time', 'started', '2026-12-01', null),
  project('shipped', 'completed', '2026-10-05', now - 10 * day),
  project('idea', 'backlog', null, null),
]

it('draws each Linear cycle and project starter from the selected account', async () => {
  const world = makeTestDb()
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: identity, SECRETS: world.secrets })
  try {
    await world.db
      .insert(schema.workspaces)
      .values({ id: 'linear-ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await initPlugins([linearPlugin()], {
      env,
      dataDir: '',
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ db: world.db, secrets: world.secrets, activeIdentity: identity, ...testCoreSeams() }),
    })
    await world.db.insert(schema.integrations).values({
      id: 'selected',
      userId: 'owner',
      provider: 'linear',
      label: 'Linear',
      encryptedCredentials: await world.secrets.seal('selected-key'),
      authKind: 'api_key',
      status: 'connected',
      createdAt: now,
      updatedAt: now,
    })
    const filters: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.headers).toMatchObject({ Authorization: 'selected-key' })
        const { query, variables } = JSON.parse(String(init.body)) as {
          query: string
          variables: { filter: { and: Record<string, { gt?: string }>[] } | null }
        }
        if (query.includes('cycles('))
          return Response.json({ data: { organization: { urlKey: 'acme' }, cycles: page(CYCLES) } })
        // Like Linear, a completed-after filter leaves out projects that never completed.
        const after = variables.filter?.and.find((clause) => clause.completedAt)?.completedAt?.gt
        filters.push(variables.filter)
        return Response.json({
          data: {
            projects: page(after ? PROJECTS.filter((p) => p.completedAt !== null && p.completedAt > after) : PROJECTS),
          },
        })
      }),
    )
    const invocation = {
      principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' },
      signal: new AbortController().signal,
    }
    const draw = async (description: DataSourceDescription) => {
      const results: Record<string, number> = {}
      for (const starter of description.starterPlans ?? []) {
        // The launcher's move: onto the workspace and account the person picked.
        const plan = panelPlanSchema.parse(starter)
        for (const source of plan.sources)
          if (source.reference.kind === 'inline')
            source.reference.content.query.scope = {
              workspaceId: 'linear-ws',
              connectionId: 'selected',
              parameters: {},
            }
        const run = await runDashboard(
          env,
          {
            scope: { workspaceId: 'linear-ws' },
            target: { kind: 'draft', content: plan },
            mode: 'execution',
            evaluationTime: now,
          },
          invocation,
        )
        expect(
          run.diagnostics.problems.filter((problem) => problem.severity === 'error'),
          plan.title,
        ).toEqual([])
        results[plan.title] = run.rows.length
      }
      return results
    }
    expect(await draw(cycleSourceDescription)).toEqual({
      'Active cycles': 1,
      'Cycles finished in the last 12 weeks': 1,
      'Issues completed per cycle, by team': 1,
    })
    expect(await draw(projectSourceDescription)).toEqual({
      'Projects in progress': 2,
      'Projects by status': 3,
      'Projects past their target date': 1,
      'Projects completed in the last 12 weeks': 1,
    })
    // Two starters read every project unfiltered, and the runner answers the second from the first.
    expect(filters).toEqual([
      { and: [{ status: { type: { eq: 'started' } } }] },
      null,
      { and: [{ completedAt: { gt: iso(now - 84 * day) } }] },
    ])
  } finally {
    world.cleanup()
  }
})
