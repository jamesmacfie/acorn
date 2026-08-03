import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { brokerEnv, runProcess, runProcessOrThrow } from './proc'

const exec = promisify(execFile)
const dir = mkdtempSync(join(tmpdir(), 'acorn-proc-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const sh = (script: string, overrides: Partial<Parameters<typeof runProcess>[0]> = {}) =>
  runProcess({ file: '/bin/sh', args: ['-c', script], cwd: dir, ...overrides })

// `kill -0` probes without signalling. EPERM means the process exists but is not ours, so only
// ESRCH ("no such process") counts as dead — treating every failure as dead is how a liveness probe
// silently passes.
const alive = async (pid: string): Promise<boolean> => {
  try {
    await exec('kill', ['-0', pid])
    return true
  } catch (error) {
    return !/no such process/i.test((error as { stderr?: string }).stderr ?? '')
  }
}

describe('env allowlist', () => {
  // The four bindings the node holds that a child must never see. The denylist this replaces
  // enumerated exactly these and missed anything added later.
  const SECRETS = {
    SESSION_ENC_KEY: 'a'.repeat(64),
    INTERNAL_TOKEN: 'internal-secret',
    ACORN_API_TOKEN: 'api-secret',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    // The point of an allowlist: a binding nobody thought about is absent by DEFAULT.
    SOME_FUTURE_CREDENTIAL: 'not-yet-invented',
  }

  it('carries the shell essentials and drops every secret', () => {
    const env = brokerEnv({}, { ...SECRETS, HOME: '/home/x', PATH: '/usr/bin', UNRELATED: 'y' })
    expect(env.HOME).toBe('/home/x')
    expect(env.PATH).toBe('/usr/bin')
    for (const key of Object.keys(SECRETS)) expect(env[key]).toBeUndefined()
    expect(env.UNRELATED).toBeUndefined()
  })

  it('never lets a real child observe the node secrets', async () => {
    const result = await sh('env', { env: { PROBE: 'visible' } })
    expect(result.code).toBe(0)
    // Against the ACTUAL process env, not a fixture — this is the assertion that would have caught
    // previewUrl passing no env at all.
    const seen = new Set(result.stdout.split('\n').map((line) => line.split('=')[0]))
    for (const key of ['SESSION_ENC_KEY', 'INTERNAL_TOKEN', 'ACORN_API_TOKEN', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
      expect(seen.has(key)).toBe(false)
    }
    expect(result.stdout).toContain('PROBE=visible')
  })

  it('passthrough is additive and glob-aware, so docker keeps DOCKER_HOST without a denylist', () => {
    const parent = { DOCKER_HOST: 'unix:///x.sock', DOCKER_CONTEXT: 'orb', SESSION_ENC_KEY: 'nope', GIT_SSH: '/s' }
    const env = brokerEnv({ passthrough: ['DOCKER_*', 'GIT_SSH'] }, parent)
    expect(env.DOCKER_HOST).toBe('unix:///x.sock')
    expect(env.DOCKER_CONTEXT).toBe('orb')
    expect(env.GIT_SSH).toBe('/s')
    expect(env.SESSION_ENC_KEY).toBeUndefined()
  })

  it('spec.env wins over the allowlisted base', () => {
    const env = brokerEnv({ env: { PATH: '/override' } }, { PATH: '/usr/bin' })
    expect(env.PATH).toBe('/override')
  })
})

describe('process-group kill', () => {
  it('reaps a grandchild the direct child left behind', async () => {
    const pidFile = join(dir, 'grandchild.pid')
    // The child backgrounds a long sleeper and exits its own foreground work into a wait, so killing
    // only the direct pid would leave the sleeper running — exactly what held stdio pipes open before.
    const result = await sh(`sh -c 'echo $$ > ${pidFile}; exec sleep 30' & sleep 30`, { timeoutMs: 300 })
    expect(result.timedOut).toBe(true)

    const pid = (await readFile(pidFile, 'utf8')).trim()
    expect(pid).toMatch(/^\d+$/)
    // Give the group signal a moment to land.
    for (let i = 0; i < 40 && (await alive(pid)); i++) await new Promise((r) => setTimeout(r, 25))
    expect(await alive(pid)).toBe(false)
  })

  it('an aborted signal kills the tree and reports aborted, not timedOut', async () => {
    const controller = new AbortController()
    const pending = sh('sleep 30', { timeoutMs: 10_000, signal: controller.signal })
    await new Promise((r) => setTimeout(r, 50))
    controller.abort()
    const result = await pending
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
  })
})

describe('bounded capture', () => {
  it('truncates at the cap and lets the process finish anyway', async () => {
    const marker = join(dir, 'finished')
    const result = await sh(`head -c 200000 /dev/zero | tr '\\0' 'x'; touch ${marker}`, { maxOutputBytes: 1024 })
    expect(result.code).toBe(0)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(1024)
    // The side effect still happened: truncation is a reporting decision, not a kill.
    await expect(readFile(marker, 'utf8')).resolves.toBe('')
  })

  it('caps stdout and stderr independently', async () => {
    const result = await sh(`printf 'o%.0s' $(seq 1 5000); printf 'e%.0s' $(seq 1 5000) >&2`, { maxOutputBytes: 100 })
    expect(result.stdout.length).toBeLessThanOrEqual(100)
    expect(result.stderr.length).toBeLessThanOrEqual(100)
    expect(result.truncated).toBe(true)
  })
})

describe('failure taxonomy', () => {
  it('distinguishes "could not start" from "ran and failed"', async () => {
    const missing = await runProcess({ file: join(dir, 'definitely-not-here'), cwd: dir })
    expect(missing.spawnError).toBe('ENOENT')
    expect(missing.code).toBeNull()

    const failed = await sh('exit 3')
    expect(failed.spawnError).toBeNull()
    expect(failed.code).toBe(3)
  })

  it('runProcessOrThrow reports the exit code and keeps stderr out of the message when clean', async () => {
    await expect(runProcessOrThrow({ file: '/bin/sh', args: ['-c', 'exit 0'], cwd: dir })).resolves.toMatchObject({ code: 0 })
    await expect(sh('exit 0')).resolves.toMatchObject({ code: 0 })
    await expect(runProcessOrThrow({ file: '/bin/sh', args: ['-c', 'echo bad >&2; exit 1'], cwd: dir })).rejects.toThrow(/exited 1: bad/)
  })

  it('feeds stdin without wedging on a process that never reads it', async () => {
    await expect(sh('cat', { stdin: 'hello' })).resolves.toMatchObject({ code: 0, stdout: 'hello' })
    await expect(sh('exit 0', { stdin: 'x'.repeat(100_000) })).resolves.toMatchObject({ code: 0 })
  })
})
