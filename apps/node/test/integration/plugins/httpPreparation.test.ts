import { describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, makeTestPluginDb, makeTestRequestContext } from '@acorn/node-core/testkit'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { pluginRouteContributions } from '@acorn/node-core/server/routes/registry.ts'
import { httpPlugin } from '@acorn/plugin-http/node/index.ts'
import { WorkflowRunner, WORKFLOW_STEP_KIND } from '@acorn/plugin-workflows/testkit'

// The Node composition tier owns tests that join two plugins through their published seams.
describe('HTTP preparation errors in durable workflows', () => {
  it.each([
    { url: 'invalid {{TOKEN}}/{{TOKEN}}' },
    { url: 'https://example.test/', headers: { 'X-Token': '{{TOKEN}}\ninvalid' } },
  ])('withholds encrypted private values from failed run and step rows: $url', async (config) => {
    const http = makeTestNodeContext({ plugin: { name: 'http' }, userId: 'alice' })
    const workflows = makeTestNodeContext({ plugin: { name: 'workflows' } })
    const db = makeTestPluginDb('workflows')
    const runner = new WorkflowRunner(db.db, {
      runStep: async () => { throw new Error('No agent step expected') },
      writeHandoff: async () => {}, assembleContext: async () => '',
      evaluatePolicy: async () => ({ pass: true }), failingChecks: async () => null, notify: vi.fn(),
    }, { entries: (point) => workflows.extensionPoints.handlers(point) })
    try {
      workflows.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow steps')
      await http.db.insert(schema.workspaces).values({ id: 'workspace', name: 'Fixture', isDefault: true, sort: 0, createdAt: 0, updatedAt: 0 })
      await http.db.insert(schema.projects).values({ id: 'project', workspaceId: 'workspace', name: 'Fixture', path: null, sort: 0, hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null, createdAt: 0, updatedAt: 0 })
      await http.db.insert(schema.tasks).values({ id: 'task', title: 'Fixture', origin: 'local', projectId: 'project', branch: 'main', worktreePath: null, pullNumber: null, status: 'active', parentId: null, sort: 0, createdAt: 0, updatedAt: 0, archivedAt: null })
      await httpPlugin().init(http)
      const route = pluginRouteContributions().find((route) => route.plugin === 'http')!
      const context = await makeTestRequestContext({ plugin: 'http', principal: { kind: 'device', userId: 'alice' }, env: http.env })
      const secret = 'SyntheticPrivatePreparationValue'
      const created = await route.fetch!(new Request('http://acorn.test/projects/project/vars', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'TOKEN', kind: 'secret', value: secret, enabled: true }),
      }), context)
      expect(created.status).toBe(201)
      const fetcher = vi.fn()
      vi.stubGlobal('fetch', fetcher)
      const runId = await runner.start('task', { baseline: 'acorn-1', formatVersion: 1, name: 'Private preparation failure', steps: [{ id: 'call', name: 'Call', kind: 'http:request', with: { method: 'GET', ...config } }] })
      await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('failed'))
      const run = await runner.run(runId)
      const steps = await runner.steps(runId)
      expect(steps[0]).toMatchObject({ status: 'failed', error: expect.any(String) })
      expect(JSON.stringify({ run, steps })).not.toContain(secret)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      runner.stop()
      vi.unstubAllGlobals()
      http.cleanup()
      workflows.cleanup()
      db.cleanup()
    }
  })
})
