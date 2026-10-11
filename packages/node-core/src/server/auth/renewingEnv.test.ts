import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mintInternalToken, verifyInternalToken } from './internalTokens'
import { renewingInternalEnv } from './renewingEnv'

const KEY = 'renewal-signing-key'
const roots: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('internal credential renewal', () => {
  it('refreshes an expired reattached session without changing its signed authority', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const first = renewingInternalEnv(KEY, root, () => ({ ACORN_API_URL: 'https://127.0.0.1:1' }))
    const launched = first.internalEnv({ scope: 'task', taskId: 'task-1', sessionId: 'session-1', toolCeiling: { allow: ['task_current'], maxRisk: 'read' } })
    const path = launched.ACORN_API_TOKEN_FILE
    expect(path).toBeTruthy()
    expect(statSync(path).mode & 0o777).toBe(0o600)
    first.dispose()

    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(verifyInternalToken(KEY, launched.ACORN_API_TOKEN)).toBeNull()
    const second = renewingInternalEnv(KEY, root, () => ({}))
    const renewed = readFileSync(path, 'utf8')
    expect(renewed).not.toBe(launched.ACORN_API_TOKEN)
    expect(verifyInternalToken(KEY, renewed)).toEqual({
      scope: 'task', taskId: 'task-1', sessionId: 'session-1',
      toolCeiling: { allow: ['task_current'], maxRisk: 'read' },
    })
    second.dispose()
  })

  it('re-mints old-key session files under a rotated key once, keeping their claims', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'))
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const oldKey = 'old-signing-key'
    const before = renewingInternalEnv(oldKey, root, () => ({}))
    const claims = { scope: 'task' as const, taskId: 'task-1', sessionId: 'session-1', toolCeiling: { allow: ['task_current'], maxRisk: 'read' as const } }
    const path = before.internalEnv(claims).ACORN_API_TOKEN_FILE
    const other = before.internalEnv({ ...claims, taskId: 'task-2', sessionId: 'session-2' }).ACORN_API_TOKEN_FILE
    before.dispose()

    const rotated = renewingInternalEnv(KEY, root, () => ({}), oldKey)
    for (const [file, taskId, sessionId] of [[path, 'task-1', 'session-1'], [other, 'task-2', 'session-2']]) {
      const token = readFileSync(file, 'utf8')
      expect(verifyInternalToken(KEY, token)).toEqual({ ...claims, taskId, sessionId })
      expect(verifyInternalToken(oldKey, token)).toBeNull()
    }

    // Only the boot pass accepts the old key. A file forged with it afterwards is left to fail.
    const forged = mintInternalToken(oldKey, claims)
    writeFileSync(path, forged)
    vi.advanceTimersByTime(12 * 60 * 60 * 1000)
    expect(readFileSync(path, 'utf8')).toBe(forged)
    rotated.dispose()
  })

  it('renews a running workflow child and removes its file when the child ends', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const credentials = renewingInternalEnv(KEY, root, () => ({}))
    const child = credentials.internalEnv({ scope: 'task', taskId: 'task-1', toolCeiling: { allow: ['task_current'], maxRisk: 'read' } })
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(verifyInternalToken(KEY, child.ACORN_API_TOKEN)).toBeNull()
    expect(verifyInternalToken(KEY, readFileSync(child.ACORN_API_TOKEN_FILE, 'utf8'))).toEqual({
      scope: 'task', taskId: 'task-1', sessionId: undefined,
      toolCeiling: { allow: ['task_current'], maxRisk: 'read' },
    })
    credentials.internalEnv.release?.(child)
    expect(existsSync(child.ACORN_API_TOKEN_FILE)).toBe(false)
    expect(credentials.internalEnv({ scope: 'service' }).ACORN_API_TOKEN_FILE).toBeUndefined()
    credentials.dispose()
  })

  it('does not refresh a service token placed at a task session path', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const first = renewingInternalEnv(KEY, root, () => ({}))
    const path = first.internalEnv({ scope: 'task', taskId: 'task-1', sessionId: 'session-1' }).ACORN_API_TOKEN_FILE
    first.dispose()
    const serviceToken = mintInternalToken(KEY, { scope: 'service' })
    writeFileSync(path, serviceToken)
    const second = renewingInternalEnv(KEY, root, () => ({}))
    expect(readFileSync(path, 'utf8')).toBe(serviceToken)
    second.dispose()
  })

  it('does not renew a workflow file after its signed task is replaced', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const credentials = renewingInternalEnv(KEY, root, () => ({}))
    const child = credentials.internalEnv({ scope: 'task', taskId: 'task-1' })
    const otherTask = mintInternalToken(KEY, { scope: 'task', taskId: 'task-2' })
    writeFileSync(child.ACORN_API_TOKEN_FILE, otherTask)
    vi.advanceTimersByTime(12 * 60 * 60 * 1000)
    expect(readFileSync(child.ACORN_API_TOKEN_FILE, 'utf8')).toBe(otherTask)
    credentials.internalEnv.release?.(child)
    credentials.dispose()
  })
})
