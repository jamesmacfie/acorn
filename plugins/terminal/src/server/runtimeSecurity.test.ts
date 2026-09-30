import { describe, expect, it, vi } from 'vitest'
import type { RunTarget } from '@acorn/plugin-api/node'
import { RuntimeService, type RuntimeDeps } from './runtime'

function fixture() {
  let targets: RunTarget[] = [{ id: 'dev', command: 'approved-command', stop: 'approved-stop', urlCommand: 'approved-url' }]
  let selectedHash: string | null = 'approved-hash'
  let currentHash = 'approved-hash'
  const startSession = vi.fn(async () => 'session-1')
  const runScript = vi.fn(async (_taskId: string, _script: string, _cwd: string) => ({ ok: true, output: 'http://localhost:3000' }))
  const authorizeRepoConfig = vi.fn(async (_taskId: string, expectedHash: string) => {
    if (expectedHash !== currentHash) throw Object.assign(new Error('Needs trust'), { code: 'needs-trust' })
  })
  const deps: RuntimeDeps = {
    loadTargets: async () => ({ targets, cwd: '/synthetic-task', repoTargetIds: ['dev'], repoConfigHash: selectedHash }),
    startSession,
    runScript,
    authorizeRepoConfig,
    onExit: () => () => {},
    isRunning: () => true,
    exitCode: () => undefined,
    killSession: vi.fn(),
  }
  return {
    deps, startSession, runScript, authorizeRepoConfig,
    edit: (next: RunTarget[], hash: string | null, acknowledged = 'approved-hash') => {
      targets = next
      selectedHash = hash
      currentHash = acknowledged
    },
  }
}

describe('run-target configuration admission', () => {
  it('keeps default URL, status, and stop scripts from the admitted instance after repository edits', async () => {
    const f = fixture()
    const service = new RuntimeService(f.deps)
    await service.start('task-1', 'dev')
    expect(f.authorizeRepoConfig).toHaveBeenCalledWith('task-1', 'approved-hash')
    f.edit([{ id: 'dev', command: 'edited-command', stop: 'edited-stop', urlCommand: 'edited-url' }], 'edited-hash')
    expect(await service.defaultUrl('task-1')).toBe('http://localhost:3000')
    expect(await service.status('task-1', 'dev')).toEqual({ running: true, url: 'http://localhost:3000' })
    await service.stop('task-1', 'dev')
    expect(f.runScript.mock.calls.map((call) => call[1])).toEqual(['approved-url', 'approved-url', 'approved-stop'])
    // Reading a running instance does not silently approve the edited configuration.
    expect(f.authorizeRepoConfig).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it.each(['start', 'restart'] as const)('refuses %s of stale selected commands before execution', async (operation) => {
    const f = fixture()
    const service = new RuntimeService(f.deps)
    // Current bytes were restored to an acknowledged snapshot after an unreviewed selection.
    f.edit([{ id: 'dev', command: 'unreviewed-command', restart: 'unreviewed-restart' }], 'unreviewed-hash')
    await expect(service[operation]('task-1', 'dev')).rejects.toMatchObject({ code: 'needs-trust' })
    expect(f.authorizeRepoConfig).toHaveBeenCalledWith('task-1', 'unreviewed-hash')
    expect(f.startSession).not.toHaveBeenCalled()
    expect(f.runScript).not.toHaveBeenCalled()
    service.dispose()
  })

  it.each(['start', 'restart'] as const)('refuses %s of repo targets with no captured identity', async (operation) => {
    const f = fixture()
    const service = new RuntimeService(f.deps)
    f.edit([{ id: 'dev', command: 'command', restart: 'restart' }], null)
    await expect(service[operation]('task-1', 'dev')).rejects.toMatchObject({ code: 'needs-trust' })
    expect(f.authorizeRepoConfig).not.toHaveBeenCalled()
    expect(f.startSession).not.toHaveBeenCalled()
    expect(f.runScript).not.toHaveBeenCalled()
    service.dispose()
  })

  it('admits a matching repo restart and leaves personal or DB targets ungated', async () => {
    const f = fixture()
    f.edit([{ id: 'dev', command: 'approved-command', restart: 'approved-restart' }], 'approved-hash')
    const service = new RuntimeService(f.deps)
    expect(await service.restart('task-1', 'dev')).toMatchObject({ ok: true })
    expect(f.runScript).toHaveBeenCalledWith('task-1', 'approved-restart', '/synthetic-task')
    f.authorizeRepoConfig.mockClear()
    const personal = new RuntimeService({
      ...f.deps,
      loadTargets: async () => ({ targets: [{ id: 'personal', command: 'personal-command' }], cwd: '/synthetic-task', repoTargetIds: [], repoConfigHash: null }),
    })
    expect(await personal.start('task-1', 'personal')).toMatchObject({ ok: true })
    expect(f.authorizeRepoConfig).not.toHaveBeenCalled()
    expect(f.startSession).toHaveBeenCalledWith('task-1', { id: 'personal', command: 'personal-command' }, '/synthetic-task')
    service.dispose()
    personal.dispose()
  })
})
