import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunTarget } from './repoConfig'
import { parseUrlOutput, resolveTargetUrl, RuntimeService, type RuntimeDeps } from './runtime'

const execP = promisify(execFile)

describe('resolveTargetUrl precedence', () => {
  it('url wins, url_command parses last stdout line, neither → undefined', async () => {
    const run = async () => ({ ok: true, output: 'starting…\nhttp://localhost:5173\n' })
    expect(await resolveTargetUrl({ url: 'http://fixed:1' }, run)).toBe('http://fixed:1')
    expect(await resolveTargetUrl({ urlCommand: './url.sh' }, run)).toBe('http://localhost:5173')
    expect(await resolveTargetUrl({}, run)).toBeUndefined()
    expect(await resolveTargetUrl({ urlCommand: './url.sh' }, async () => ({ ok: false }))).toBeUndefined()
  })
  it('parseUrlOutput takes the last non-empty line', () => {
    expect(parseUrlOutput('a\n\n b \n')).toBe('b')
    expect(parseUrlOutput('')).toBeUndefined()
  })
})

// Real child processes as "sessions" (the app uses PTY sessions; the service only needs
// start/isRunning/kill semantics) + a real temp dir the fake target writes markers into.
describe('RuntimeService over real processes', () => {
  let dir: string
  const children = new Map<string, ChildProcess>()
  let targets: RunTarget[]

  const deps: RuntimeDeps = {
    loadTargets: async () => ({ targets, cwd: dir }),
    startSession: async (_taskId, target, cwd) => {
      const child = spawn('/bin/sh', ['-c', target.command], { cwd })
      const id = `s${children.size + 1}`
      children.set(id, child)
      return id
    },
    isRunning: (id) => {
      const c = children.get(id)
      return !!c && c.exitCode === null && !c.killed
    },
    exitCode: (id) => children.get(id)?.exitCode,
    killSession: (id) => children.get(id)?.kill(),
    runScript: async (_taskId, script, cwd) => {
      try {
        const { stdout } = await execP('/bin/sh', ['-c', script], { cwd, timeout: 10_000 })
        return { ok: true, output: stdout }
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'failed' }
      }
    },
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-run-'))
    children.clear()
  })

  afterEach(() => {
    for (const c of children.values()) c.kill()
    rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (pred: () => boolean, ms = 3000) => {
    const t0 = Date.now()
    while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25))
  }

  it('start writes the marker, status resolves the url_command URL, stop runs the declared stop', async () => {
    targets = [
      {
        id: 'stack',
        command: 'touch started.marker && sleep 30',
        stop: 'touch stopped.marker',
        urlCommand: 'echo http://localhost:8080',
      },
    ]
    const svc = new RuntimeService(deps)
    const res = await svc.start('t1', 'stack')
    expect(res.ok).toBe(true)
    await waitFor(() => existsSync(join(dir, 'started.marker')))
    expect(existsSync(join(dir, 'started.marker'))).toBe(true)

    const status = await svc.status('t1', 'stack')
    expect(status).toEqual({ running: true, url: 'http://localhost:8080' })

    const stopped = await svc.stop('t1', 'stack')
    expect(stopped).toEqual({ ok: true })
    expect(existsSync(join(dir, 'stopped.marker'))).toBe(true)
    expect((await svc.status('t1', 'stack')).running).toBe(false)
  })

  it('a one-shot target reports exitCode once done; unknown target errors cleanly', async () => {
    targets = [{ id: 'seed', command: 'true' }]
    const svc = new RuntimeService(deps)
    await svc.start('t1', 'seed')
    await waitFor(() => !deps.isRunning('s1'))
    const status = await svc.status('t1', 'seed')
    expect(status.running).toBe(false)
    expect(status.exitCode).toBe(0)
    expect((await svc.start('t1', 'nope')).ok).toBe(false)
  })

  it('restart runs the declared restart command when present', async () => {
    targets = [{ id: 'dev', command: 'sleep 30', restart: 'touch restarted.marker' }]
    const svc = new RuntimeService(deps)
    await svc.start('t1', 'dev')
    await waitFor(() => deps.isRunning('s1'))
    const res = await svc.restart('t1', 'dev')
    expect(res.ok).toBe(true)
    expect(existsSync(join(dir, 'restarted.marker'))).toBe(true)
    // The original session is untouched (in-place restart, no kill).
    expect(deps.isRunning('s1')).toBe(true)
  })

  it('restart with no restart command stops then starts (cold start when nothing was running)', async () => {
    targets = [{ id: 'dev', command: 'touch started.marker && sleep 30' }]
    const svc = new RuntimeService(deps)
    const res = await svc.restart('t1', 'dev')
    expect(res.ok).toBe(true)
    await waitFor(() => existsSync(join(dir, 'started.marker')))
    expect(existsSync(join(dir, 'started.marker'))).toBe(true)
    expect((await svc.status('t1', 'dev')).running).toBe(true)
  })

  it('defaultUrl prefers the default target and its fixed url', async () => {
    targets = [
      { id: 'seed', command: 'true' },
      { id: 'stack', command: 'sleep 30', url: 'http://localhost:8080', default: true },
    ]
    const svc = new RuntimeService(deps)
    expect(await svc.defaultUrl('t1')).toBe('http://localhost:8080')
  })
})
