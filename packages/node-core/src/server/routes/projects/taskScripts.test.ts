import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp } from '../../index'
import { makeTestDb, testEnv, type TestDb } from '../../../testkit/db'
import { mintInternalToken } from '../../auth/internalTokens'
import { schema } from '../../db'
import { taskScripts } from '../../taskScripts/service'
import { buildAgentTools } from '../../agentTools/coreTools'

let db: TestDb
const app = createApp()
const key = 'script-test-key'
beforeEach(() => {
  db = makeTestDb()
  for (const id of ['own', 'foreign']) db.db.insert(schema.tasks).values({ id, title: id, projectId: 'p', origin: 'local', status: 'active', createdAt: 1, updatedAt: 1 }).run()
})
afterEach(() => db.cleanup())
const request = (path: string, taskId = 'own') => app.request(path, { headers: { 'x-acorn-internal': mintInternalToken(key, { scope: 'task', taskId }) } }, testEnv({ DB: db.db, INTERNAL_TOKEN: key, ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} } }))
it('confines status, waits and historical log reads to the authenticated task', async () => {
  const foreign = taskScripts(db.db).admit('foreign', 'setup')
  for (const suffix of ['', '/wait?phase=setup&timeoutMs=0', '/logs?phase=setup']) expect((await request(`/v1/core/tasks/foreign/scripts${suffix}`)).status).toBe(404)
  expect((await request('/v1/core/tasks/own/scripts')).status).toBe(200)
  expect((await request(`/v1/core/tasks/own/scripts/logs?phase=setup&attemptId=${foreign.attemptId}`)).status).toBe(404)
  expect((await request('/v1/core/tasks/own/scripts/wait?phase=setup&timeoutMs=30001')).status).toBe(400)
  expect((await request('/v1/core/tasks/own/scripts/logs?phase=setup&tailLines=1001')).status).toBe(400)
})
it('projects strict task tools over the same authoritative service without caller task substitution', async () => {
  const tools = buildAgentTools({ db: db.db, secrets: db.secrets }).filter(tool => tool.name.startsWith('task_scripts_'))
  expect(tools).toHaveLength(3)
  for (const tool of tools) {
    expect(tool.risk).toBe('read')
    expect(tool.input.safeParse({ taskId: 'foreign', phase: 'setup' }).success).toBe(false)
  }
  const status = tools.find(tool => tool.name === 'task_scripts_status')!
  const result = await status.handler({}, { taskId: 'own', userLogin: 'u' })
  expect(result).toEqual(taskScripts(db.db).status('own'))
  const wait = tools.find(tool => tool.name === 'task_scripts_wait')!
  expect(await wait.handler({ phase: 'setup', timeoutMs: 0 }, { taskId: 'own', userLogin: 'u' })).toMatchObject({ matched: false, reason: 'not_started' })
})
