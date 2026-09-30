import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeTestCoreServices, makeTestDb, schema } from '@acorn/plugin-api/testkit'
import { createRuntimeService } from './runChannel'

describe('run-channel snapshot trust integration', () => {
  it.each(['start', 'restart'] as const)('rejects stale %s selection through the real core trust gate', async (operation) => {
    const testDb = makeTestDb()
    const repo = mkdtempSync(join(tmpdir(), 'acorn-run-admission-'))
    let service: ReturnType<typeof createRuntimeService> | undefined
    try {
      mkdirSync(join(repo, '.acorn'))
      const file = join(repo, '.acorn', 'config.toml')
      const approvedText = '[scripts.run.dev]\ncommand = "approved-command"\nrestart = "approved-restart"\n'
      writeFileSync(file, approvedText)
      const now = Date.now()
      await testDb.db.insert(schema.workspaces).values({ id: 'workspace', name: 'Test', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
      await testDb.db.insert(schema.projects).values({ id: 'project', name: 'Test', path: repo, workspaceId: 'workspace', sort: 0, createdAt: now, updatedAt: now })
      await testDb.db.insert(schema.tasks).values({ id: 'task', title: 'Test', origin: 'local', projectId: 'project', branch: null, status: 'active', sort: 0, createdAt: now, updatedAt: now })
      const core = makeTestCoreServices(testDb)
      const approved = await core.tasks.runConfig('task')
      if ('error' in approved || !approved.repoConfigHash) throw new Error('Missing fixture snapshot')
      await testDb.db.insert(schema.configAcks).values({ projectId: 'project', hash: approved.repoConfigHash, snapshot: 'Test acknowledgement', ackedAt: now })
      writeFileSync(file, '[scripts.run.dev]\ncommand = "unreviewed-command"\nrestart = "unreviewed-restart"\n')
      const loadConfig = core.tasks.runConfig.bind(core.tasks)
      core.tasks.runConfig = async (taskId) => {
        const selected = await loadConfig(taskId)
        writeFileSync(file, approvedText)
        return selected
      }
      const runProcess = vi.spyOn(core.proc, 'runProcess')
      const startSession = vi.fn(async () => 'session')
      service = createRuntimeService(core, {
        startSession, isRunning: () => false, onExit: () => () => {},
        exitCode: () => undefined, killSession: vi.fn(),
      })
      await expect(service[operation]('task', 'dev')).rejects.toMatchObject({ code: 'needs-trust' })
      expect(startSession).not.toHaveBeenCalled()
      expect(runProcess).not.toHaveBeenCalled()
      // Ordinary acknowledged repository configuration still admits a start.
      expect(await service.start('task', 'dev')).toMatchObject({ ok: true, sessionId: 'session' })
      expect(startSession).toHaveBeenCalledWith('task', expect.objectContaining({ command: 'approved-command' }), repo)
    } finally {
      service?.dispose()
      testDb.cleanup()
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
