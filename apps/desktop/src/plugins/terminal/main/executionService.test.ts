import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { CommandExecutionService } from './executionService'

vi.setConfig({ testTimeout: 15_000 })

let cwd: string | null = null
vi.mock('../../../core/main/taskWorktree', () => ({ taskRoot: async () => cwd }))

const TASK = '77777777-7777-4777-8777-777777777777'

async function settle(svc: CommandExecutionService, id: string) {
  for (let i = 0; i < 100; i++) {
    const e = await svc.get(id, true)
    if (e.status !== 'running' && e.status !== 'queued') return e
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('execution did not settle')
}

describe('CommandExecutionService', () => {
  let t: TestDb
  let dir: string
  let svc: CommandExecutionService

  beforeEach(() => {
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-exec-'))
    cwd = dir
    svc = new CommandExecutionService(t.db)
  })
  afterEach(() => {
    cwd = null
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a command and captures bounded output', async () => {
    const exec = await svc.create(TASK, { command: 'echo hello', env: {}, timeoutMs: 5000, maxOutputBytes: 1_048_576 })
    expect(exec.status).toBe('running')
    const done = await settle(svc, exec.id)
    expect(done.status).toBe('succeeded')
    expect(done.exitCode).toBe(0)
    expect(done.stdout).toBe('hello\n')
  })

  it('marks a non-zero exit as failed', async () => {
    const exec = await svc.create(TASK, { command: 'exit 3', env: {}, timeoutMs: 5000, maxOutputBytes: 1_048_576 })
    const done = await settle(svc, exec.id)
    expect(done.status).toBe('failed')
    expect(done.exitCode).toBe(3)
  })

  it('times out a long command', async () => {
    const exec = await svc.create(TASK, { command: 'sleep 10', env: {}, timeoutMs: 150, maxOutputBytes: 1_048_576 })
    const done = await settle(svc, exec.id)
    expect(done.status).toBe('timed-out')
  })

  it('strips Acorn secrets from the inherited environment', async () => {
    process.env.INTERNAL_TOKEN = 'super-secret-token'
    try {
      const exec = await svc.create(TASK, { command: 'echo "[$INTERNAL_TOKEN]"', env: {}, timeoutMs: 5000, maxOutputBytes: 1_048_576 })
      const done = await settle(svc, exec.id)
      expect(done.stdout).toBe('[]\n')
    } finally {
      delete process.env.INTERNAL_TOKEN
    }
  })

  it('requires a worktree and 404s an unknown execution', async () => {
    cwd = null
    await expect(svc.create(TASK, { command: 'echo x', env: {}, timeoutMs: 5000, maxOutputBytes: 1_048_576 })).rejects.toMatchObject({ code: 'conflict' })
    cwd = dir
    await expect(svc.get('88888888-8888-4888-8888-888888888888', false)).rejects.toMatchObject({ code: 'not_found' })
  })
})
