import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticateInternalToken, mintInternalToken, verifyInternalToken } from './internalTokens'
import { ActiveCredentials } from './activeCredentials'
import { sessionCredentialPath } from './credentialFile'
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
    const first = renewingInternalEnv(
      KEY,
      root,
      () => ({ ACORN_API_URL: 'https://127.0.0.1:1' }),
      new ActiveCredentials(),
    )
    const launched = first.internalEnv({
      scope: 'task',
      taskId: 'task-1',
      sessionId: 'session-1',
      toolCeiling: { allow: ['task_current'], maxRisk: 'read' },
    })
    const path = launched.ACORN_API_TOKEN_FILE
    expect(path).toBeTruthy()
    expect(statSync(path).mode & 0o777).toBe(0o600)
    first.dispose()

    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(verifyInternalToken(KEY, launched.ACORN_API_TOKEN)).toBeNull()
    const second = renewingInternalEnv(KEY, root, () => ({}), new ActiveCredentials())
    const renewed = readFileSync(path, 'utf8')
    expect(renewed).not.toBe(launched.ACORN_API_TOKEN)
    expect(verifyInternalToken(KEY, renewed)).toEqual({
      scope: 'task',
      taskId: 'task-1',
      sessionId: 'session-1',
      toolCeiling: { allow: ['task_current'], maxRisk: 'read' },
      credentialId: verifyInternalToken(KEY, renewed)?.credentialId,
    })
    // Renewal keeps the credential, so a copy of the launch token and the renewed file share one id.
    expect(
      JSON.parse(Buffer.from(launched.ACORN_API_TOKEN.slice('acorn_it_'.length).split('.')[0]!, 'base64url').toString())
        .i,
    ).toBe(verifyInternalToken(KEY, renewed)?.credentialId)
    second.dispose()
  })

  it('renews a running workflow child and removes its file when the child ends', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const credentials = renewingInternalEnv(KEY, root, () => ({}), new ActiveCredentials())
    const child = credentials.internalEnv({
      scope: 'task',
      taskId: 'task-1',
      toolCeiling: { allow: ['task_current'], maxRisk: 'read' },
    })
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(verifyInternalToken(KEY, child.ACORN_API_TOKEN)).toBeNull()
    expect(verifyInternalToken(KEY, readFileSync(child.ACORN_API_TOKEN_FILE, 'utf8'))).toEqual({
      scope: 'task',
      taskId: 'task-1',
      sessionId: undefined,
      toolCeiling: { allow: ['task_current'], maxRisk: 'read' },
      credentialId: expect.any(String),
    })
    credentials.internalEnv.release?.(child)
    expect(existsSync(child.ACORN_API_TOKEN_FILE)).toBe(false)
    expect(credentials.internalEnv({ scope: 'service' }).ACORN_API_TOKEN_FILE).toBeUndefined()
    credentials.dispose()
  })

  it('does not refresh a service token placed at a task session path', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const first = renewingInternalEnv(KEY, root, () => ({}), new ActiveCredentials())
    const path = first.internalEnv({ scope: 'task', taskId: 'task-1', sessionId: 'session-1' }).ACORN_API_TOKEN_FILE
    first.dispose()
    const serviceToken = mintInternalToken(KEY, { scope: 'service' })
    writeFileSync(path, serviceToken)
    const second = renewingInternalEnv(KEY, root, () => ({}), new ActiveCredentials())
    expect(readFileSync(path, 'utf8')).toBe(serviceToken)
    second.dispose()
  })

  it('does not renew a workflow file after its signed task is replaced', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const credentials = renewingInternalEnv(KEY, root, () => ({}), new ActiveCredentials())
    const child = credentials.internalEnv({ scope: 'task', taskId: 'task-1' })
    const otherTask = mintInternalToken(KEY, { scope: 'task', taskId: 'task-2' })
    writeFileSync(child.ACORN_API_TOKEN_FILE, otherTask)
    vi.advanceTimersByTime(12 * 60 * 60 * 1000)
    expect(readFileSync(child.ACORN_API_TOKEN_FILE, 'utf8')).toBe(otherTask)
    credentials.internalEnv.release?.(child)
    credentials.dispose()
  })

  // A penetration review found a released child's copied token still authenticating, for up to 48 hours.
  it('revokes a child token when the child is released', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const active = new ActiveCredentials()
    const credentials = renewingInternalEnv(KEY, root, () => ({}), active)
    const child = credentials.internalEnv({ scope: 'task', taskId: 'task-1' })
    expect(authenticateInternalToken(KEY, active, child.ACORN_API_TOKEN)).toMatchObject({ taskId: 'task-1' })
    credentials.internalEnv.release?.(child)
    expect(verifyInternalToken(KEY, child.ACORN_API_TOKEN)).not.toBeNull()
    expect(authenticateInternalToken(KEY, active, child.ACORN_API_TOKEN)).toBeNull()
    credentials.dispose()
  })

  it('keeps one live token per session, and revokes it when the session is removed', () => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const active = new ActiveCredentials()
    const credentials = renewingInternalEnv(KEY, root, () => ({}), active)
    const session = { scope: 'task', taskId: 'task-1', sessionId: 'session-1' } as const
    const first = credentials.internalEnv(session)
    const second = credentials.internalEnv(session)
    expect(authenticateInternalToken(KEY, active, first.ACORN_API_TOKEN)).toBeNull()
    expect(authenticateInternalToken(KEY, active, second.ACORN_API_TOKEN)).toMatchObject({ sessionId: 'session-1' })

    credentials.internalEnv.revokeSession?.({ taskId: 'task-1', sessionId: 'session-1' })
    expect(existsSync(second.ACORN_API_TOKEN_FILE)).toBe(false)
    expect(authenticateInternalToken(KEY, active, second.ACORN_API_TOKEN)).toBeNull()
    // A copy written back to the removed session's path is deleted at the next refresh, not renewed.
    writeFileSync(second.ACORN_API_TOKEN_FILE, second.ACORN_API_TOKEN)
    vi.advanceTimersByTime(12 * 60 * 60 * 1000)
    expect(existsSync(second.ACORN_API_TOKEN_FILE)).toBe(false)
    expect(authenticateInternalToken(KEY, active, second.ACORN_API_TOKEN)).toBeNull()
    credentials.dispose()
  })

  it('after a restart, keeps the live session tokens and none of the released children', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const first = renewingInternalEnv(KEY, root, () => ({}), new ActiveCredentials())
    const session = first.internalEnv({ scope: 'task', taskId: 'task-1', sessionId: 'session-1' })
    const child = first.internalEnv({ scope: 'task', taskId: 'task-1' })
    first.dispose()
    const active = new ActiveCredentials()
    const second = renewingInternalEnv(KEY, root, () => ({}), active)
    expect(authenticateInternalToken(KEY, active, readFileSync(session.ACORN_API_TOKEN_FILE, 'utf8'))).toMatchObject({
      sessionId: 'session-1',
    })
    expect(authenticateInternalToken(KEY, active, child.ACORN_API_TOKEN)).toBeNull()
    second.dispose()
  })

  it('gives a session file from before credential ids a live token at start, and refuses the old one', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-credentials-'))
    roots.push(root)
    const payload = Buffer.from(
      JSON.stringify({ s: 'task', t: 'task-1', n: 'session-1', e: Date.now() + 60_000 }),
    ).toString('base64url')
    const legacy = `acorn_it_${payload}.${createHmac('sha256', KEY).update(payload).digest('base64url')}`
    const path = sessionCredentialPath(root, 'task-1', 'session-1')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, legacy)
    const active = new ActiveCredentials()
    const credentials = renewingInternalEnv(KEY, root, () => ({}), active)
    expect(verifyInternalToken(KEY, legacy)).toMatchObject({ sessionId: 'session-1', credentialId: undefined })
    expect(authenticateInternalToken(KEY, active, legacy)).toBeNull()
    expect(authenticateInternalToken(KEY, active, readFileSync(path, 'utf8'))).toMatchObject({ sessionId: 'session-1' })
    credentials.dispose()
  })
})
